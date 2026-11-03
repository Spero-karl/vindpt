/**
 * Service de gestion des Produits, Stocks et Mouvements
 * Transactions atomiques Firestore (prévention des stocks négatifs)
 * Application : GESTION BOISSONS
 */

import { db } from '../config/firebase';
import { 
  collection, 
  doc, 
  onSnapshot, 
  setDoc, 
  updateDoc, 
  runTransaction, 
  query, 
  orderBy, 
  serverTimestamp, 
  addDoc,
  getDoc,
  writeBatch
} from 'firebase/firestore';
import { Product, StockMovement, Sale, Purchase, Expense, PackagingType } from '../types/models';

export const INITIAL_PRODUCTS_SEED: Omit<Product, 'id' | 'createdAt' | 'updatedAt'>[] = [
  {
    name: 'Bière Heineken 33cl',
    brand: 'Heineken',
    category: 'bieres',
    formatVolume: '33cl',
    baseUnit: 'bouteille',
    unitsPerCase: 24,
    stockBottles: 96, // 4 casiers
    retailPrice: 800,
    casePrice: 18000,
    costPrice: 650,
    minStockAlert: 24, // Alerte à 1 casier
    status: 'actif',
  },
  {
    name: 'Bière Castel Beer 65cl',
    brand: 'Castel',
    category: 'bieres',
    formatVolume: '65cl',
    baseUnit: 'bouteille',
    unitsPerCase: 12,
    stockBottles: 18, // Moins de 2 casiers -> alerte
    retailPrice: 900,
    casePrice: 10000,
    costPrice: 750,
    minStockAlert: 24,
    status: 'actif',
  },
  {
    name: 'Vin Rouge Bordeaux Supérieur',
    brand: 'Château Bel Air',
    category: 'vins',
    formatVolume: '75cl',
    baseUnit: 'bouteille',
    unitsPerCase: 12,
    stockBottles: 8, // Stock faible !
    retailPrice: 6500,
    casePrice: 72000,
    costPrice: 4800,
    minStockAlert: 12,
    status: 'actif',
  },
  {
    name: 'Champagne Laurent-Perrier Brut',
    brand: 'Laurent-Perrier',
    category: 'champagnes',
    formatVolume: '75cl',
    baseUnit: 'bouteille',
    unitsPerCase: 6,
    stockBottles: 14,
    retailPrice: 45000,
    casePrice: 250000,
    costPrice: 35000,
    minStockAlert: 6,
    status: 'actif',
  },
  {
    name: 'Whisky Johnnie Walker Black Label',
    brand: 'Johnnie Walker',
    category: 'whiskies',
    formatVolume: '1L',
    baseUnit: 'bouteille',
    unitsPerCase: 12,
    stockBottles: 5, // Stock faible !
    retailPrice: 22000,
    casePrice: 250000,
    costPrice: 17500,
    minStockAlert: 8,
    status: 'actif',
  },
  {
    name: 'Jus d’Orange 100% Pur Jus',
    brand: 'Pressea',
    category: 'jus',
    formatVolume: '1L',
    baseUnit: 'brique',
    unitsPerCase: 12,
    stockBottles: 36,
    retailPrice: 1200,
    casePrice: 13000,
    costPrice: 950,
    minStockAlert: 12,
    status: 'actif',
  },
  {
    name: 'Eau Minérale Naturelle 1.5L',
    brand: 'Céleste',
    category: 'eaux',
    formatVolume: '1.5L',
    baseUnit: 'bouteille',
    unitsPerCase: 6,
    stockBottles: 48,
    retailPrice: 500,
    casePrice: 2500,
    costPrice: 350,
    minStockAlert: 18,
    status: 'actif',
  },
];

/**
 * Écoute la liste des produits en temps réel et initialise si vide
 */
export function listenToProducts(callback: (products: Product[]) => void): () => void {
  if (!db) {
    callback([]);
    return () => {};
  }

  const productsRef = collection(db, 'products');

  const unsub = onSnapshot(productsRef, async (snapshot) => {
    if (snapshot.empty && db) {
      // Auto-amorçage des boissons initiales si le catalogue est vide
      try {
        for (const p of INITIAL_PRODUCTS_SEED) {
          const newDocRef = doc(collection(db, 'products'));
          await setDoc(newDocRef, {
            ...p,
            id: newDocRef.id,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        }
      } catch (err) {
        console.warn('Erreur seed produits:', err);
      }
    }

    const list: Product[] = snapshot.docs.map(d => ({
      ...(d.data() as Product),
      id: d.id,
    }));

    // Tri stable par catégorie puis par nom
    list.sort((a, b) => {
      const catA = a.category || '';
      const catB = b.category || '';
      const compCat = catA.localeCompare(catB);
      if (compCat !== 0) return compCat;
      return (a.name || '').localeCompare(b.name || '');
    });

    callback(list);
  }, (err) => {
    console.warn('Erreur listener produits:', err);
    callback([]);
  });

  return unsub;
}

/**
 * Supprime récursivement les propriétés undefined d'un objet ou tableau.
 * Firestore interdit formellement la valeur undefined dans setDoc, updateDoc et transaction.set.
 */
export function removeUndefinedFields<T>(val: T): T {
  if (val === undefined || val === null) {
    return val;
  }
  if (Array.isArray(val)) {
    return val.map((item) => removeUndefinedFields(item)) as unknown as T;
  }
  if (typeof val === 'object' && !(val instanceof Date)) {
    const res: Record<string, any> = {};
    for (const [key, v] of Object.entries(val)) {
      if (v !== undefined) {
        res[key] = removeUndefinedFields(v);
      }
    }
    return res as T;
  }
  return val;
}

/**
 * Enregistre une vente atomique avec transaction Firestore
 * Empêche tout double clic, tout stock négatif et toute valeur undefined
 */
/**
 * Enregistre une vente atomique avec transaction Firestore
 * Empêche tout double clic, tout stock négatif et toute valeur undefined
 */
export async function executeSaleTransaction(
  saleData: Omit<Sale, 'id' | 'status'> & { id?: string }
): Promise<{ success: boolean; saleId?: string; error?: string }> {
  if (!db) {
    return { success: false, error: 'Base de données non disponible.' };
  }

  if (!saleData || !saleData.items || saleData.items.length === 0) {
    return { success: false, error: 'Aucun article dans la vente.' };
  }

  const firestore = db;

  try {
    const saleId = await runTransaction(firestore, async (transaction) => {
      // 1. Déterminer la référence avec clé d'idempotence
      const newSaleRef = saleData.id 
        ? doc(firestore, 'sales', saleData.id)
        : doc(collection(firestore, 'sales'));

      // Vérifier si la vente a déjà été traitée (protection idempotence contre double clic)
      const existingSaleSnap = await transaction.get(newSaleRef);
      if (existingSaleSnap.exists()) {
        return newSaleRef.id;
      }

      // 2. Lire et vérifier tous les produits concernés (TOUTES LES LECTURES EN PREMIER)
      const productDocsToUpdate: { ref: any; currentStock: number; newStock: number; name: string }[] = [];

      for (const item of saleData.items) {
        const prodRef = doc(firestore, 'products', item.productId);
        const prodSnap = await transaction.get(prodRef);

        if (!prodSnap.exists()) {
          throw new Error(`Le produit "${item.productName}" n'existe plus dans le catalogue.`);
        }

        const prod = prodSnap.data() as Product;
        const requiredBottles = Math.max(1, Number(item.bottlesDeducted) || 1);

        if (prod.stockBottles < requiredBottles) {
          throw new Error(
            `Stock insuffisant pour "${prod.name}". Stock disponible: ${prod.stockBottles} bouteilles, demandé: ${requiredBottles}.`
          );
        }

        productDocsToUpdate.push({
          ref: prodRef,
          currentStock: prod.stockBottles,
          newStock: prod.stockBottles - requiredBottles,
          name: prod.name,
        });
      }

      // 3. Préparer le document de vente (SANS AUCUNE VALEUR UNDEFINED)
      const cleanItems = saleData.items.map((item) => {
        const cleanItem: Record<string, any> = {
          productId: String(item.productId || ''),
          productName: String(item.productName || 'Boisson'),
          packaging: (item.packaging || 'bouteille') as PackagingType,
          quantity: Math.max(1, Number(item.quantity) || 1),
          unitPrice: Math.max(0, Number(item.unitPrice) || 0),
          totalPrice: Math.max(0, Number(item.totalPrice) || 0),
          bottlesDeducted: Math.max(1, Number(item.bottlesDeducted) || 1),
          costPriceAtSale: typeof item.costPriceAtSale === 'number' ? Math.max(0, item.costPriceAtSale) : 0,
        };
        return removeUndefinedFields(cleanItem);
      });

      const cleanSalePayload: Record<string, any> = {
        id: newSaleRef.id,
        date: saleData.date || new Date().toISOString().split('T')[0],
        timestamp: Number(saleData.timestamp) || Date.now(),
        createdAt: new Date().toISOString(),
        sellerId: saleData.sellerId || 'usr_utilisateur',
        sellerName: saleData.sellerName || 'Utilisateur',
        items: cleanItems,
        totalAmount: Number(saleData.totalAmount) || 0,
        paymentMethod: saleData.paymentMethod === 'mobile_money' ? 'mobile_money' : 'especes',
        status: 'validee',
      };

      if (typeof saleData.notes === 'string' && saleData.notes.trim().length > 0) {
        cleanSalePayload.notes = saleData.notes.trim();
      }

      if (saleData.paymentBreakdown) {
        cleanSalePayload.paymentBreakdown = removeUndefinedFields(saleData.paymentBreakdown);
      }

      const finalSale = removeUndefinedFields(cleanSalePayload);
      transaction.set(newSaleRef, finalSale);

      // 4. Décrémenter les stocks et enregistrer les mouvements atomiquement
      for (const update of productDocsToUpdate) {
        transaction.update(update.ref, {
          stockBottles: update.newStock,
          updatedAt: new Date().toISOString(),
        });

        const movRef = doc(collection(firestore, 'stock_movements'));
        const movement = removeUndefinedFields({
          id: movRef.id,
          productId: update.ref.id,
          productName: update.name,
          type: 'vente',
          quantityBottles: -(update.currentStock - update.newStock),
          previousStock: update.currentStock,
          newStock: update.newStock,
          reason: `Vente #${newSaleRef.id.slice(-6)}`,
          performedBy: saleData.sellerId || 'usr_utilisateur',
          performedByName: saleData.sellerName || 'Utilisateur',
          timestamp: new Date().toISOString(),
        });
        transaction.set(movRef, movement);
      }

      // 5. Enregistrer dans le journal d'audit
      const auditRef = doc(collection(firestore, 'audit_logs'));
      const auditRecord = removeUndefinedFields({
        id: auditRef.id,
        action: 'VENTE_EFFECTUEE',
        entity: 'sale',
        performedBy: saleData.sellerId || 'usr_utilisateur',
        performedByName: saleData.sellerName || 'Utilisateur',
        timestamp: new Date().toISOString(),
        details: `Vente validée #${newSaleRef.id.slice(-6)} (${saleData.items.length} lignes, paiement: ${cleanSalePayload.paymentMethod}).`,
      });
      transaction.set(auditRef, auditRecord);

      return newSaleRef.id;
    });

    return { success: true, saleId };
  } catch (err) {
    const errorStr = (err instanceof Error ? err.message : String(err)).toLowerCase();
    if (errorStr.includes('offline') || errorStr.includes('unavailable') || errorStr.includes('network') || errorStr.includes('failed to get document')) {
      try {
        const batch = writeBatch(firestore);
        const newSaleRef = saleData.id 
          ? doc(firestore, 'sales', saleData.id) 
          : doc(collection(firestore, 'sales'));

        const cleanItems = saleData.items.map((item) => removeUndefinedFields({
          productId: String(item.productId || ''),
          productName: String(item.productName || 'Boisson'),
          packaging: (item.packaging || 'bouteille') as PackagingType,
          quantity: Math.max(1, Number(item.quantity) || 1),
          unitPrice: Math.max(0, Number(item.unitPrice) || 0),
          totalPrice: Math.max(0, Number(item.totalPrice) || 0),
          bottlesDeducted: Math.max(1, Number(item.bottlesDeducted) || 1),
          costPriceAtSale: typeof item.costPriceAtSale === 'number' ? Math.max(0, item.costPriceAtSale) : 0,
        }));

        const cleanSale = removeUndefinedFields({
          id: newSaleRef.id,
          date: saleData.date || new Date().toISOString().split('T')[0],
          timestamp: Number(saleData.timestamp) || Date.now(),
          createdAt: new Date().toISOString(),
          sellerId: saleData.sellerId || 'usr_utilisateur',
          sellerName: saleData.sellerName || 'Utilisateur',
          items: cleanItems,
          totalAmount: Number(saleData.totalAmount) || 0,
          paymentMethod: saleData.paymentMethod === 'mobile_money' ? 'mobile_money' : 'especes',
          status: 'validee',
          ...(saleData.notes?.trim() ? { notes: saleData.notes.trim() } : {}),
        });

        batch.set(newSaleRef, cleanSale);

        for (const item of saleData.items) {
          const prodRef = doc(firestore, 'products', item.productId);
          const snap = await getDoc(prodRef).catch(() => null);
          const currentStock = snap && snap.exists() ? ((snap.data() as Product).stockBottles || 0) : 0;
          const deducted = Math.max(1, Number(item.bottlesDeducted) || 1);
          const newStock = Math.max(0, currentStock - deducted);

          batch.update(prodRef, {
            stockBottles: newStock,
            updatedAt: new Date().toISOString(),
          });

          const movRef = doc(collection(firestore, 'stock_movements'));
          batch.set(movRef, removeUndefinedFields({
            id: movRef.id,
            productId: item.productId,
            productName: item.productName,
            type: 'vente',
            quantityBottles: -deducted,
            previousStock: currentStock,
            newStock,
            reason: `Vente #${newSaleRef.id.slice(-6)} (Synchronisation locale)`,
            performedBy: saleData.sellerId || 'usr_utilisateur',
            performedByName: saleData.sellerName || 'Utilisateur',
            timestamp: new Date().toISOString(),
          }));
        }

        const auditRef = doc(collection(firestore, 'audit_logs'));
        batch.set(auditRef, removeUndefinedFields({
          id: auditRef.id,
          action: 'VENTE_EFFECTUEE',
          entity: 'sale',
          performedBy: saleData.sellerId || 'usr_utilisateur',
          performedByName: saleData.sellerName || 'Utilisateur',
          timestamp: new Date().toISOString(),
          details: `Vente validée #${newSaleRef.id.slice(-6)} (Mode résilience réseau).`,
        }));

        await batch.commit();
        return { success: true, saleId: newSaleRef.id };
      } catch (batchErr) {
        return {
          success: false,
          error: batchErr instanceof Error ? batchErr.message : String(batchErr),
        };
      }
    }

    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Enregistre un arrivage d'achat avec mise à jour du stock et calcul du CMP
 * CORRECTION CLOUD FIRESTORE : Toutes les lectures (transaction.get) sont obligatoirement
 * exécutées AVANT la moindre écriture (transaction.set / transaction.update).
 */
export async function executePurchaseTransaction(
  purchaseData: Omit<Purchase, 'id'> & { id?: string }
): Promise<{ success: boolean; purchaseId?: string; error?: string }> {
  if (!db) return { success: false, error: 'Base de données non disponible.' };

  const firestore = db;

  try {
    const purchaseId = await runTransaction(firestore, async (transaction) => {
      // 1. Déterminer la référence
      const newPurchaseRef = purchaseData.id 
        ? doc(firestore, 'purchases', purchaseData.id)
        : doc(collection(firestore, 'purchases'));

      // Vérification idempotence si id fourni (LECTURE EN PREMIER)
      const existingSnap = await transaction.get(newPurchaseRef);
      if (existingSnap.exists()) {
        return newPurchaseRef.id;
      }

      // 2. LECTURES DE TOUS LES PRODUITS EN PREMIER (MANDATORY IN CLOUD FIRESTORE)
      interface ProductUpdatePlan {
        ref: any;
        prod: Product;
        addedBottles: number;
        newUnitCost: number;
        currentStock: number;
        newTotalStock: number;
        newCmp: number;
      }
      const updatePlans: ProductUpdatePlan[] = [];

      for (const item of purchaseData.items) {
        const prodRef = doc(firestore, 'products', item.productId);
        const prodSnap = await transaction.get(prodRef);

        if (!prodSnap.exists()) {
          throw new Error(`Le produit avec l'ID "${item.productId}" est introuvable.`);
        }

        const prod = prodSnap.data() as Product;
        const currentStock = prod.stockBottles || 0;
        const currentCost = prod.costPrice || 0;
        const addedBottles = Math.max(1, Number(item.bottlesAdded) || 1);
        const newUnitCost = Math.max(0, Number(item.unitCostPerBottle) || 0);

        // Calcul du Prix Moyen Pondéré (PMP / CMP)
        const totalValuation = (currentStock * currentCost) + (addedBottles * newUnitCost);
        const newTotalStock = currentStock + addedBottles;
        const newCmp = newTotalStock > 0 ? Math.round(totalValuation / newTotalStock) : newUnitCost;

        updatePlans.push({
          ref: prodRef,
          prod,
          addedBottles,
          newUnitCost,
          currentStock,
          newTotalStock,
          newCmp,
        });
      }

      // 3. TOUTES LES ÉCRITURES APRÈS LES LECTURES
      // A. Enregistrement de l'achat dans la collection purchases
      const cleanItems = purchaseData.items.map(it => removeUndefinedFields({
        productId: String(it.productId || ''),
        productName: String(it.productName || 'Boisson'),
        packaging: (it.packaging || 'carton') as PackagingType,
        quantity: Math.max(1, Number(it.quantity) || 1),
        unitsPerPack: Math.max(1, Number(it.unitsPerPack) || 1),
        bottlesAdded: Math.max(1, Number(it.bottlesAdded) || 1),
        unitCostPerBottle: Math.max(0, Number(it.unitCostPerBottle) || 0),
        totalCost: Math.max(0, Number(it.totalCost) || 0),
      }));

      const cleanPurchasePayload: Record<string, any> = {
        id: newPurchaseRef.id,
        supplier: purchaseData.supplier?.trim() || 'Fournisseur Comptoir',
        date: purchaseData.date || new Date().toISOString().split('T')[0],
        fees: Number(purchaseData.fees) || 0,
        items: cleanItems,
        totalAmount: Number(purchaseData.totalAmount) || 0,
        receivedBy: purchaseData.receivedBy || 'usr_utilisateur',
        receivedByName: purchaseData.receivedByName || 'Utilisateur',
        createdAt: purchaseData.createdAt || new Date().toISOString(),
      };

      if (purchaseData.invoiceRef && purchaseData.invoiceRef.trim()) {
        cleanPurchasePayload.invoiceRef = purchaseData.invoiceRef.trim();
      }

      const finalPurchase = removeUndefinedFields(cleanPurchasePayload);
      transaction.set(newPurchaseRef, finalPurchase);

      // B. Mise à jour des stocks et des PMP
      for (const plan of updatePlans) {
        transaction.update(plan.ref, {
          stockBottles: plan.newTotalStock,
          costPrice: plan.newCmp,
          updatedAt: new Date().toISOString(),
        });

        // Mouvement de stock
        const movRef = doc(collection(firestore, 'stock_movements'));
        const cleanMov = removeUndefinedFields({
          id: movRef.id,
          productId: plan.prod.id,
          productName: plan.prod.name,
          type: 'entree_achat',
          quantityBottles: plan.addedBottles,
          previousStock: plan.currentStock,
          newStock: plan.newTotalStock,
          reason: `Réception Achat #${newPurchaseRef.id.slice(-6)} (${purchaseData.supplier})`,
          performedBy: purchaseData.receivedBy || 'usr_utilisateur',
          performedByName: purchaseData.receivedByName || 'Utilisateur',
          timestamp: new Date().toISOString(),
        });
        transaction.set(movRef, cleanMov);
      }

      // C. Journal d'audit
      const auditRef = doc(collection(firestore, 'audit_logs'));
      const auditRecord = removeUndefinedFields({
        id: auditRef.id,
        action: 'APPROVISIONNEMENT_EFFECTUE',
        entity: 'purchase',
        performedBy: purchaseData.receivedBy || 'usr_utilisateur',
        performedByName: purchaseData.receivedByName || 'Utilisateur',
        timestamp: new Date().toISOString(),
        details: `Approvisionnement #${newPurchaseRef.id.slice(-6)} (${purchaseData.supplier}, montant: ${purchaseData.totalAmount} FCFA).`,
      });
      transaction.set(auditRef, auditRecord);

      return newPurchaseRef.id;
    });

    return { success: true, purchaseId };
  } catch (err) {
    const errorStr = (err instanceof Error ? err.message : String(err)).toLowerCase();
    if (errorStr.includes('offline') || errorStr.includes('unavailable') || errorStr.includes('network') || errorStr.includes('failed to get document')) {
      try {
        const batch = writeBatch(firestore);
        const newPurchaseRef = purchaseData.id 
          ? doc(firestore, 'purchases', purchaseData.id) 
          : doc(collection(firestore, 'purchases'));

        const cleanItems = purchaseData.items.map(it => removeUndefinedFields({
          productId: String(it.productId || ''),
          productName: String(it.productName || 'Boisson'),
          packaging: (it.packaging || 'carton') as PackagingType,
          quantity: Math.max(1, Number(it.quantity) || 1),
          unitsPerPack: Math.max(1, Number(it.unitsPerPack) || 1),
          bottlesAdded: Math.max(1, Number(it.bottlesAdded) || 1),
          unitCostPerBottle: Math.max(0, Number(it.unitCostPerBottle) || 0),
          totalCost: Math.max(0, Number(it.totalCost) || 0),
        }));

        const cleanPurchasePayload = removeUndefinedFields({
          id: newPurchaseRef.id,
          supplier: purchaseData.supplier?.trim() || 'Fournisseur Comptoir',
          date: purchaseData.date || new Date().toISOString().split('T')[0],
          fees: Number(purchaseData.fees) || 0,
          items: cleanItems,
          totalAmount: Number(purchaseData.totalAmount) || 0,
          receivedBy: purchaseData.receivedBy || 'usr_utilisateur',
          receivedByName: purchaseData.receivedByName || 'Utilisateur',
          createdAt: purchaseData.createdAt || new Date().toISOString(),
          ...(purchaseData.invoiceRef?.trim() ? { invoiceRef: purchaseData.invoiceRef.trim() } : {}),
        });

        batch.set(newPurchaseRef, cleanPurchasePayload);

        for (const item of purchaseData.items) {
          const prodRef = doc(firestore, 'products', item.productId);
          const snap = await getDoc(prodRef).catch(() => null);
          const currentStock = snap && snap.exists() ? ((snap.data() as Product).stockBottles || 0) : 0;
          const currentCost = snap && snap.exists() ? ((snap.data() as Product).costPrice || 0) : 0;
          const addedBottles = Math.max(1, Number(item.bottlesAdded) || 1);
          const newUnitCost = Math.max(0, Number(item.unitCostPerBottle) || 0);

          const totalValuation = (currentStock * currentCost) + (addedBottles * newUnitCost);
          const newTotalStock = currentStock + addedBottles;
          const newCmp = newTotalStock > 0 ? Math.round(totalValuation / newTotalStock) : newUnitCost;

          batch.update(prodRef, {
            stockBottles: newTotalStock,
            costPrice: newCmp,
            updatedAt: new Date().toISOString(),
          });

          const movRef = doc(collection(firestore, 'stock_movements'));
          batch.set(movRef, removeUndefinedFields({
            id: movRef.id,
            productId: item.productId,
            productName: item.productName,
            type: 'entree_achat',
            quantityBottles: addedBottles,
            previousStock: currentStock,
            newStock: newTotalStock,
            reason: `Réception Achat #${newPurchaseRef.id.slice(-6)} (${purchaseData.supplier})`,
            performedBy: purchaseData.receivedBy || 'usr_utilisateur',
            performedByName: purchaseData.receivedByName || 'Utilisateur',
            timestamp: new Date().toISOString(),
          }));
        }

        const auditRef = doc(collection(firestore, 'audit_logs'));
        batch.set(auditRef, removeUndefinedFields({
          id: auditRef.id,
          action: 'APPROVISIONNEMENT_EFFECTUE',
          entity: 'purchase',
          performedBy: purchaseData.receivedBy || 'usr_utilisateur',
          performedByName: purchaseData.receivedByName || 'Utilisateur',
          timestamp: new Date().toISOString(),
          details: `Approvisionnement #${newPurchaseRef.id.slice(-6)} (${purchaseData.supplier}, montant: ${purchaseData.totalAmount} FCFA).`,
        }));

        await batch.commit();
        return { success: true, purchaseId: newPurchaseRef.id };
      } catch (batchErr) {
        return { success: false, error: batchErr instanceof Error ? batchErr.message : String(batchErr) };
      }
    }

    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Écoute des mouvements de stock récents pour l'activité opérationnelle
 */
export function listenToRecentMovements(callback: (movements: StockMovement[]) => void): () => void {
  if (!db) {
    callback([]);
    return () => {};
  }

  const movRef = collection(db, 'stock_movements');
  const q = query(movRef, orderBy('timestamp', 'desc'));

  const unsub = onSnapshot(q, (snapshot) => {
    const list = snapshot.docs.slice(0, 10).map(d => ({
      ...(d.data() as StockMovement),
      id: d.id,
    }));
    callback(list);
  }, () => {
    callback([]);
  });

  return unsub;
}

/**
 * Écoute en direct de l'historique complet des ventes
 */
export function listenToSales(callback: (sales: Sale[]) => void): () => void {
  if (!db) {
    callback([]);
    return () => {};
  }

  const salesRef = collection(db, 'sales');
  const unsub = onSnapshot(salesRef, (snapshot) => {
    const list = snapshot.docs.map(d => ({
      ...(d.data() as Sale),
      id: d.id,
    }));
    // Tri chronologique décroissant
    list.sort((a, b) => {
      const timeA = a.timestamp || (a.createdAt ? new Date(a.createdAt).getTime() : new Date(a.date || 0).getTime());
      const timeB = b.timestamp || (b.createdAt ? new Date(b.createdAt).getTime() : new Date(b.date || 0).getTime());
      return timeB - timeA;
    });
    callback(list);
  }, (err) => {
    console.error('Erreur écoute des ventes:', err);
    callback([]);
  });

  return unsub;
}
