/**
 * Module Caisse, Ventes au Comptant & Historique avec Point Automatique
 * RÈGLE MÉTIER : 100% Comptant (Espèces / Mobile Money), transactions atomiques
 * Point total automatique : Chiffre d'affaires, Bénéfice (Marge), Encaissements caisse
 * Application : GESTION BOISSONS
 */

import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Product, Sale, SaleItem, PackagingType, PaymentMethod, PAYMENT_METHOD_LABELS } from '../../types/models';
import { listenToProducts, executeSaleTransaction, listenToSales } from '../../services/products';
import { 
  ReceiptText, 
  Search, 
  Plus, 
  Minus, 
  Trash2, 
  CheckCircle2, 
  AlertCircle, 
  Wine, 
  Printer, 
  X,
  Coins,
  Smartphone,
  TrendingUp,
  Calendar,
  Layers,
  History,
  ShoppingCart,
  Eye,
  Wallet
} from 'lucide-react';

interface CartLine {
  product: Product;
  packaging: PackagingType;
  quantity: number;
  unitPrice: number;
}

export const SalesView: React.FC = () => {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';

  // Onglet actif : 'pos' (Caisse / Nouvelle Vente) ou 'history' (Historique & Point Comptable)
  const [activeTab, setActiveTab] = useState<'pos' | 'history'>('pos');

  // Produits & Ventes en temps réel
  const [products, setProducts] = useState<Product[]>([]);
  const [salesList, setSalesList] = useState<Sale[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Panier en cours
  const [cart, setCart] = useState<CartLine[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('especes');
  const [saleNotes, setSaleNotes] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Reçu validé ou modal de consultation
  const [completedSale, setCompletedSale] = useState<any | null>(null);
  const [inspectSale, setInspectSale] = useState<Sale | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Filtres pour l'historique et le point comptable
  const [historyPeriod, setHistoryPeriod] = useState<'today' | 'week' | 'month' | 'all'>('today');
  const [historySearch, setHistorySearch] = useState('');
  const [historyMethodFilter, setHistoryMethodFilter] = useState<'all' | 'especes' | 'mobile_money'>('all');

  useEffect(() => {
    const unsubProds = listenToProducts((list) => {
      setProducts(list);
    });

    const unsubSales = listenToSales((list) => {
      setSalesList(list);
    });

    return () => {
      unsubProds();
      unsubSales();
    };
  }, []);

  const addToCart = (product: Product, packaging: PackagingType) => {
    setErrorMessage(null);
    const unitPrice = packaging === 'carton' || packaging === 'casier' 
      ? product.casePrice 
      : product.retailPrice;

    const existingIndex = cart.findIndex(
      line => line.product.id === product.id && line.packaging === packaging
    );

    if (existingIndex > -1) {
      const updated = [...cart];
      updated[existingIndex].quantity += 1;
      setCart(updated);
    } else {
      setCart([...cart, {
        product,
        packaging,
        quantity: 1,
        unitPrice,
      }]);
    }
  };

  const updateQuantity = (index: number, newQty: number) => {
    if (newQty <= 0) {
      removeFromCart(index);
      return;
    }
    const updated = [...cart];
    updated[index].quantity = newQty;
    setCart(updated);
  };

  const removeFromCart = (index: number) => {
    const updated = cart.filter((_, i) => i !== index);
    setCart(updated);
  };

  const clearCart = () => {
    setCart([]);
    setSaleNotes('');
    setErrorMessage(null);
  };

  // Montant total du panier
  const totalAmount = cart.reduce((sum, line) => sum + (line.unitPrice * line.quantity), 0);

  // Validation atomique de la vente
  const handleValidateSale = async () => {
    if (cart.length === 0) return;
    setErrorMessage(null);
    setIsProcessing(true);

    const saleItems: SaleItem[] = cart.map(line => {
      const isCase = line.packaging === 'carton' || line.packaging === 'casier';
      const bottlesPerUnit = isCase ? line.product.unitsPerCase : 1;
      const bottlesDeducted = line.quantity * bottlesPerUnit;

      return {
        productId: line.product.id,
        productName: line.product.name,
        packaging: line.packaging,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        totalPrice: line.unitPrice * line.quantity,
        bottlesDeducted,
        costPriceAtSale: line.product.costPrice,
      };
    });

    const uniqueSaleId = 'vnt_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 8);

    const salePayload: Omit<Sale, 'status'> & { id: string } = {
      id: uniqueSaleId,
      date: new Date().toISOString().split('T')[0],
      timestamp: Date.now(),
      sellerId: profile?.uid || 'usr_utilisateur',
      sellerName: profile?.displayName || 'Utilisateur',
      items: saleItems,
      totalAmount,
      paymentMethod: paymentMethod === 'mobile_money' ? 'mobile_money' : 'especes',
      ...(saleNotes.trim() ? { notes: saleNotes.trim() } : {}),
    };

    const res = await executeSaleTransaction(salePayload);

    setIsProcessing(false);

    if (res.success && res.saleId) {
      setCompletedSale({
        id: res.saleId,
        items: saleItems,
        totalAmount,
        paymentMethod,
        date: new Date().toLocaleString('fr-FR'),
        sellerName: profile?.displayName || 'Utilisateur',
      });
      clearCart();
    } else {
      setErrorMessage(res.error || 'Erreur lors de la validation de la vente.');
    }
  };

  // Filtrage des boissons dans le catalogue de caisse
  const filteredProducts = products.filter(
    p => p.status === 'actif' && (
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (p.brand && p.brand.toLowerCase().includes(searchQuery.toLowerCase()))
    )
  );

  // Filtrage des ventes pour l'historique et le point comptable
  const now = new Date();
  const validSales = salesList.filter(s => s.status === 'validee');

  const filteredHistory = validSales.filter(s => {
    // 1. Filtre temporel
    const saleDate = new Date(s.timestamp || s.createdAt || s.date);
    if (historyPeriod === 'today') {
      if (saleDate.toDateString() !== now.toDateString()) return false;
    } else if (historyPeriod === 'week') {
      const diffDays = (now.getTime() - saleDate.getTime()) / (1000 * 3600 * 24);
      if (diffDays > 7) return false;
    } else if (historyPeriod === 'month') {
      if (saleDate.getMonth() !== now.getMonth() || saleDate.getFullYear() !== now.getFullYear()) {
        return false;
      }
    }

    // 2. Filtre moyen de paiement
    if (historyMethodFilter !== 'all') {
      if (s.paymentMethod !== historyMethodFilter) return false;
    }

    // 3. Filtre recherche textuelle
    if (historySearch.trim()) {
      const q = historySearch.toLowerCase();
      const matchId = s.id.toLowerCase().includes(q);
      const matchSeller = s.sellerName?.toLowerCase().includes(q);
      const matchItems = s.items?.some(it => it.productName.toLowerCase().includes(q));
      if (!matchId && !matchSeller && !matchItems) return false;
    }

    return true;
  });

  // Calculs du POINT TOTAL AUTOMATIQUE sur les ventes filtrées
  const totalRevenue = filteredHistory.reduce((sum, s) => sum + s.totalAmount, 0);

  const totalCogs = filteredHistory.reduce((sum, s) => {
    const saleCost = (s.items || []).reduce((itemSum, item) => {
      const unitCost = item.costPriceAtSale || 0;
      const count = item.bottlesDeducted || (item.quantity * (item.packaging === 'carton' ? 12 : 1));
      return itemSum + (unitCost * count);
    }, 0);
    return sum + saleCost;
  }, 0);

  const totalGrossProfit = totalRevenue - totalCogs;
  const profitMarginPercent = totalRevenue > 0 ? (totalGrossProfit / totalRevenue) * 100 : 0;

  const totalCashSales = filteredHistory
    .filter(s => s.paymentMethod === 'especes' || (s.paymentMethod as string) === 'cash')
    .reduce((sum, s) => sum + s.totalAmount, 0);

  const totalMobileMoneySales = filteredHistory
    .filter(s => s.paymentMethod === 'mobile_money' || ['wave', 'orange_money', 'mtn_momo'].includes(s.paymentMethod as string))
    .reduce((sum, s) => sum + s.totalAmount, 0);

  const totalBottlesSold = filteredHistory.reduce((sum, s) => {
    const bottles = (s.items || []).reduce((iSum, it) => iSum + (it.bottlesDeducted || it.quantity), 0);
    return sum + bottles;
  }, 0);

  const salesCount = filteredHistory.length;
  const averageTicket = salesCount > 0 ? Math.round(totalRevenue / salesCount) : 0;

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-8">
      {/* Messages d'erreur */}
      {errorMessage && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Barre de navigation entre Terminal Caisse et Historique / Point */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#FAF8F5] p-3 rounded-3xl border border-[#E2DDD3] shadow-xs">
        <div className="flex rounded-2xl bg-[#F4F1E9] p-1 border border-[#E2DDD3] text-xs font-semibold">
          <button
            type="button"
            onClick={() => setActiveTab('pos')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl transition ${
              activeTab === 'pos'
                ? 'bg-[#294637] text-[#FAF8F5] shadow-xs font-bold'
                : 'text-[#6A726D] hover:text-[#1F2421]'
            }`}
          >
            <ShoppingCart className="w-4 h-4" />
            <span>Caisse / Nouvelle Vente</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl transition ${
              activeTab === 'history'
                ? 'bg-[#294637] text-[#FAF8F5] shadow-xs font-bold'
                : 'text-[#6A726D] hover:text-[#1F2421]'
            }`}
          >
            <History className="w-4 h-4" />
            <span>Historique & Point Total</span>
            {validSales.length > 0 && (
              <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                activeTab === 'history' ? 'bg-white/20 text-white' : 'bg-[#294637]/10 text-[#294637]'
              }`}>
                {validSales.length}
              </span>
            )}
          </button>
        </div>

        <div className="flex items-center gap-2 px-3 text-xs text-[#5A625D]">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span>Enregistrement automatique en direct</span>
        </div>
      </div>

      {activeTab === 'pos' ? (
        /* VUE 1 : TERMINAL DE CAISSE (Nouvelle Vente) */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Section Gauche : Sélection des Boissons (7/12) */}
          <div className="lg:col-span-7 space-y-4">
            <div className="bg-[#FAF8F5] p-4 rounded-3xl border border-[#E2DDD3] shadow-xs">
              <div className="relative mb-3">
                <Search className="w-4 h-4 text-[#7A847E] absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Rechercher une boisson à ajouter au ticket..."
                  className="w-full pl-9 pr-4 py-2.5 bg-[#F4F1E9] border border-[#E2DDD3] rounded-2xl text-xs text-[#1F2421] placeholder-[#7A847E] focus:outline-none focus:ring-1 focus:ring-[#294637]"
                />
              </div>

              <p className="text-[11px] text-[#5A625D]">
                Touchez un conditionnement pour l'ajouter directement au ticket de caisse :
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[600px] overflow-y-auto pr-1">
              {filteredProducts.map((p) => {
                const isAvailable = p.stockBottles > 0;
                const hasCaseStock = p.stockBottles >= p.unitsPerCase;

                return (
                  <div
                    key={p.id}
                    className={`p-3.5 rounded-2xl border transition bg-[#FAF8F5] ${
                      isAvailable ? 'border-[#E2DDD3]' : 'border-[#E8E4DA] opacity-60'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-1 mb-2">
                      <div>
                        <h4 className="text-xs font-bold text-[#1F2421] leading-snug">{p.name}</h4>
                        <p className="text-[10px] text-[#6A726D]">
                          Format : {p.formatVolume} • Stock : {p.stockBottles} btl
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-[#E8E4DA]">
                      {/* Bouton vente bouteille */}
                      <button
                        type="button"
                        disabled={!isAvailable}
                        onClick={() => addToCart(p, 'bouteille')}
                        className="flex flex-col items-center justify-center p-2 rounded-xl bg-[#F4F1E9] hover:bg-[#EFEAE1] border border-[#E2DDD3] transition text-center disabled:opacity-50 cursor-pointer"
                      >
                        <span className="text-[10px] text-[#6A726D] font-medium">1 Bouteille</span>
                        <span className="text-xs font-bold text-[#1F2421] mt-0.5">
                          {p.retailPrice.toLocaleString('fr-FR')} F
                        </span>
                      </button>

                      {/* Bouton vente carton */}
                      <button
                        type="button"
                        disabled={!hasCaseStock}
                        onClick={() => addToCart(p, 'carton')}
                        className="flex flex-col items-center justify-center p-2 rounded-xl bg-[#294637]/10 hover:bg-[#294637]/20 border border-[#294637]/20 transition text-center disabled:opacity-40 cursor-pointer"
                      >
                        <span className="text-[10px] text-[#294637] font-semibold">1 Ctn ({p.unitsPerCase}b)</span>
                        <span className="text-xs font-bold text-[#294637] mt-0.5">
                          {p.casePrice.toLocaleString('fr-FR')} F
                        </span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Section Droite : Ticket de Caisse & Validation (5/12) */}
          <div className="lg:col-span-5 space-y-4">
            <div className="bg-[#FAF8F5] rounded-3xl border border-[#E2DDD3] p-5 shadow-xs flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between pb-3 border-b border-[#E8E4DA] mb-3">
                  <div className="flex items-center gap-2">
                    <ReceiptText className="w-4 h-4 text-[#294637]" />
                    <h3 className="text-sm font-bold text-[#1F2421]">Ticket en Cours</h3>
                  </div>
                  {cart.length > 0 && (
                    <button
                      onClick={clearCart}
                      className="text-[11px] text-[#B87555] hover:underline cursor-pointer"
                    >
                      Vider le panier
                    </button>
                  )}
                </div>

                {/* Lignes du panier */}
                {cart.length === 0 ? (
                  <div className="py-12 text-center text-xs text-[#7A847E]">
                    <ReceiptText className="w-8 h-8 mx-auto text-[#D8D2C5] mb-2" />
                    <p>Aucun article sélectionné.</p>
                    <p className="text-[11px] mt-1">Touchez une bouteille ou un carton à gauche.</p>
                  </div>
                ) : (
                  <div className="space-y-2.5 max-h-64 overflow-y-auto pr-1">
                    {cart.map((line, idx) => (
                      <div
                        key={`${line.product.id}-${line.packaging}`}
                        className="p-3 rounded-2xl bg-[#F4F1E9] border border-[#E8E4DA] flex items-center justify-between text-xs"
                      >
                        <div className="min-w-0 pr-2">
                          <h5 className="font-bold text-[#1F2421] truncate">{line.product.name}</h5>
                          <p className="text-[10px] text-[#6A726D]">
                            {line.packaging === 'carton' ? `Carton (${line.product.unitsPerCase} btles)` : 'Bouteille unitaire'} • {line.unitPrice.toLocaleString('fr-FR')} FCFA
                          </p>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <div className="flex items-center bg-[#FAF8F5] rounded-xl border border-[#E2DDD3]">
                            <button
                              onClick={() => updateQuantity(idx, line.quantity - 1)}
                              className="p-1 text-[#6A726D] hover:text-[#1F2421] cursor-pointer"
                            >
                              <Minus className="w-3 h-3" />
                            </button>
                            <span className="px-2 font-bold text-xs text-[#1F2421]">{line.quantity}</span>
                            <button
                              onClick={() => updateQuantity(idx, line.quantity + 1)}
                              className="p-1 text-[#6A726D] hover:text-[#1F2421] cursor-pointer"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          </div>

                          <span className="font-bold text-xs text-[#1F2421] min-w-[70px] text-right">
                            {(line.unitPrice * line.quantity).toLocaleString('fr-FR')} F
                          </span>

                          <button
                            onClick={() => removeFromCart(idx)}
                            className="p-1 text-[#7A847E] hover:text-rose-600 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Pied de Caisse : Moyen de paiement & Bouton Valider */}
              {cart.length > 0 && (
                <div className="mt-4 pt-4 border-t border-[#E8E4DA] space-y-3">
                  {/* Choix moyen de paiement (2 uniques : Espèces et Mobile Money) */}
                  <div>
                    <label className="block text-[11px] font-semibold text-[#1F2421] mb-1.5">
                      Moyen de paiement (au comptant) :
                    </label>
                    <div className="grid grid-cols-2 gap-2 text-xs font-medium">
                      {(['especes', 'mobile_money'] as PaymentMethod[]).map((method) => (
                        <button
                          key={method}
                          type="button"
                          onClick={() => setPaymentMethod(method)}
                          className={`py-2 px-2.5 rounded-xl border text-center transition cursor-pointer ${
                            paymentMethod === method
                              ? 'bg-[#294637] text-[#FAF8F5] font-bold border-[#294637] shadow-xs'
                              : 'bg-[#F4F1E9] text-[#1F2421] border-[#E2DDD3] hover:bg-[#EFEAE1]'
                          }`}
                        >
                          {PAYMENT_METHOD_LABELS[method]}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Total & Règle pas de crédit */}
                  <div className="p-3.5 rounded-2xl bg-[#294637]/5 border border-[#294637]/20 flex items-center justify-between">
                    <div>
                      <span className="text-[10px] text-[#6A726D] uppercase font-bold tracking-wider block">
                        Total net à payer
                      </span>
                      <span className="text-xl font-bold text-[#294637]">
                        {totalAmount.toLocaleString('fr-FR')} FCFA
                      </span>
                    </div>
                    <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-[#294637]/10 text-[#294637]">
                      Comptant direct
                    </span>
                  </div>

                  {/* Bouton de validation atomique */}
                  <button
                    type="button"
                    disabled={isProcessing}
                    onClick={handleValidateSale}
                    className="w-full py-3.5 rounded-2xl bg-[#294637] hover:bg-[#1E3429] text-[#FAF8F5] text-sm font-bold shadow-md transition disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>{isProcessing ? 'Validation sur serveur...' : 'Encaisser & Enregistrer la vente'}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* VUE 2 : HISTORIQUE DES VENTES & POINT COMPTABLE AUTOMATIQUE */
        <div className="space-y-6">
          {/* 1. Sélecteur de période */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#FAF8F5] p-4 rounded-3xl border border-[#E2DDD3] shadow-xs">
            <div>
              <h3 className="text-sm font-bold text-[#1F2421] flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-[#294637]" />
                Point Comptable Automatique de l'Activité
              </h3>
              <p className="text-xs text-[#5A625D]">
                Suivi du chiffre d'affaires, marge brute réelle et ventilation des encaissements
              </p>
            </div>

            <div className="flex items-center gap-1.5 bg-[#F4F1E9] p-1 rounded-2xl border border-[#E2DDD3] text-xs font-semibold">
              {[
                { id: 'today', label: 'Aujourd’hui' },
                { id: 'week', label: '7 jours' },
                { id: 'month', label: 'Ce mois' },
                { id: 'all', label: 'Tout' },
              ].map(p => (
                <button
                  key={p.id}
                  onClick={() => setHistoryPeriod(p.id as any)}
                  className={`px-3 py-1.5 rounded-xl transition cursor-pointer ${
                    historyPeriod === p.id 
                      ? 'bg-[#294637] text-white shadow-xs font-bold' 
                      : 'text-[#6A726D] hover:text-[#1F2421]'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* 2. Cartes Synthétiques du POINT TOTAL */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Chiffre d'Affaires */}
            <div className="p-5 rounded-3xl bg-[#FAF8F5] border border-[#E2DDD3] shadow-xs flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-bold text-[#5A625D] uppercase tracking-wider">
                    Chiffre d’Affaires
                  </span>
                  <div className="w-8 h-8 rounded-xl bg-[#294637]/10 text-[#294637] flex items-center justify-center">
                    <ReceiptText className="w-4 h-4" />
                  </div>
                </div>
                <div className="text-xl sm:text-2xl font-bold text-[#294637]">
                  {totalRevenue.toLocaleString('fr-FR')} FCFA
                </div>
              </div>
              <p className="text-[11px] text-[#5A625D] mt-3 border-t border-[#E8E4DA] pt-2">
                {salesCount} vente{salesCount > 1 ? 's' : ''} validée{salesCount > 1 ? 's' : ''}
              </p>
            </div>

            {/* Bénéfice Réalisé (Marge brute) */}
            <div className="p-5 rounded-3xl bg-[#FAF8F5] border border-[#E2DDD3] shadow-xs flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-bold text-[#5A625D] uppercase tracking-wider">
                    Bénéfice (Marge Brute)
                  </span>
                  <div className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-800 flex items-center justify-center">
                    <TrendingUp className="w-4 h-4" />
                  </div>
                </div>
                <div className="text-xl sm:text-2xl font-bold text-emerald-700">
                  {totalGrossProfit.toLocaleString('fr-FR')} FCFA
                </div>
              </div>
              <p className="text-[11px] text-[#5A625D] mt-3 border-t border-[#E8E4DA] pt-2">
                Taux de marge : <span className="font-bold text-emerald-700">{profitMarginPercent.toFixed(1)}%</span>
              </p>
            </div>

            {/* Total Espèces */}
            <div className="p-5 rounded-3xl bg-[#FAF8F5] border border-[#E2DDD3] shadow-xs flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-bold text-[#5A625D] uppercase tracking-wider">
                    Caisse Espèces
                  </span>
                  <div className="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-800 flex items-center justify-center">
                    <Coins className="w-4 h-4" />
                  </div>
                </div>
                <div className="text-xl sm:text-2xl font-bold text-[#1F2421]">
                  {totalCashSales.toLocaleString('fr-FR')} FCFA
                </div>
              </div>
              <p className="text-[11px] text-[#5A625D] mt-3 border-t border-[#E8E4DA] pt-2">
                Encaissé en liquide physiquement
              </p>
            </div>

            {/* Total Mobile Money */}
            <div className="p-5 rounded-3xl bg-[#FAF8F5] border border-[#E2DDD3] shadow-xs flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-bold text-[#5A625D] uppercase tracking-wider">
                    Caisse Mobile Money
                  </span>
                  <div className="w-8 h-8 rounded-xl bg-sky-500/10 text-sky-800 flex items-center justify-center">
                    <Smartphone className="w-4 h-4" />
                  </div>
                </div>
                <div className="text-xl sm:text-2xl font-bold text-[#1F2421]">
                  {totalMobileMoneySales.toLocaleString('fr-FR')} FCFA
                </div>
              </div>
              <p className="text-[11px] text-[#5A625D] mt-3 border-t border-[#E8E4DA] pt-2">
                Wave, Orange Money, MTN
              </p>
            </div>
          </div>

          {/* 3. Filtres & Recherche de l'historique */}
          <div className="bg-[#FAF8F5] p-4 rounded-3xl border border-[#E2DDD3] shadow-xs space-y-3">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-[#7A847E] absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                  placeholder="Rechercher par ticket, vendeur ou boisson..."
                  className="w-full pl-9 pr-4 py-2 bg-[#F4F1E9] border border-[#E2DDD3] rounded-xl text-xs text-[#1F2421] placeholder-[#7A847E]"
                />
              </div>

              <div className="flex items-center gap-1.5 text-xs">
                <button
                  type="button"
                  onClick={() => setHistoryMethodFilter('all')}
                  className={`px-3 py-2 rounded-xl transition ${
                    historyMethodFilter === 'all'
                      ? 'bg-[#294637] text-white font-bold'
                      : 'bg-[#F4F1E9] text-[#6A726D] hover:bg-[#EFEAE1]'
                  }`}
                >
                  Tous paiements
                </button>
                <button
                  type="button"
                  onClick={() => setHistoryMethodFilter('especes')}
                  className={`px-3 py-2 rounded-xl transition ${
                    historyMethodFilter === 'especes'
                      ? 'bg-[#294637] text-white font-bold'
                      : 'bg-[#F4F1E9] text-[#6A726D] hover:bg-[#EFEAE1]'
                  }`}
                >
                  Espèces
                </button>
                <button
                  type="button"
                  onClick={() => setHistoryMethodFilter('mobile_money')}
                  className={`px-3 py-2 rounded-xl transition ${
                    historyMethodFilter === 'mobile_money'
                      ? 'bg-[#294637] text-white font-bold'
                      : 'bg-[#F4F1E9] text-[#6A726D] hover:bg-[#EFEAE1]'
                  }`}
                >
                  Mobile Money
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between text-[11px] text-[#6A726D] pt-1">
              <span>{filteredHistory.length} transaction{filteredHistory.length > 1 ? 's' : ''} trouvée{filteredHistory.length > 1 ? 's' : ''}</span>
              <span>Total bouteilles vendues : <strong className="text-[#1F2421]">{totalBottlesSold} btl</strong> • Panier moyen : <strong className="text-[#1F2421]">{averageTicket.toLocaleString('fr-FR')} FCFA</strong></span>
            </div>
          </div>

          {/* 4. Journal Détaillé des Ventes */}
          <div className="bg-[#FAF8F5] rounded-3xl border border-[#E2DDD3] overflow-hidden shadow-xs">
            {filteredHistory.length === 0 ? (
              <div className="p-12 text-center text-xs text-[#6A726D]">
                <ReceiptText className="w-10 h-10 mx-auto text-[#D8D2C5] mb-2" />
                <p className="font-semibold text-[#1F2421]">Aucune vente enregistrée sur cette période.</p>
                <p className="mt-1">Passez sur l'onglet "Caisse" pour enregistrer votre première vente.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#F4F1E9] border-b border-[#E2DDD3] text-[#5A625D] text-[11px] uppercase tracking-wider">
                    <tr>
                      <th className="py-3 px-4 font-bold">Réf / Date</th>
                      <th className="py-3 px-4 font-bold">Vendeur</th>
                      <th className="py-3 px-4 font-bold">Articles Vendus</th>
                      <th className="py-3 px-4 font-bold">Paiement</th>
                      <th className="py-3 px-4 font-bold text-right">Montant</th>
                      <th className="py-3 px-4 font-bold text-right">Bénéfice</th>
                      <th className="py-3 px-4 font-bold text-center">Ticket</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E8E4DA]">
                    {filteredHistory.map((sale) => {
                      const saleTime = new Date(sale.timestamp || sale.createdAt || sale.date);
                      const isCash = sale.paymentMethod === 'especes' || (sale.paymentMethod as string) === 'cash';

                      // Calcul du coût et du bénéfice sur cette vente
                      const saleCost = (sale.items || []).reduce((itemSum, item) => {
                        const unitCost = item.costPriceAtSale || 0;
                        const count = item.bottlesDeducted || (item.quantity * (item.packaging === 'carton' ? 12 : 1));
                        return itemSum + (unitCost * count);
                      }, 0);
                      const saleProfit = sale.totalAmount - saleCost;

                      return (
                        <tr key={sale.id} className="hover:bg-[#F4F1E9]/70 transition">
                          <td className="py-3 px-4">
                            <span className="font-mono font-bold text-[#294637]">
                              #{sale.id.slice(-6).toUpperCase()}
                            </span>
                            <div className="text-[10px] text-[#6A726D]">
                              {saleTime.toLocaleDateString('fr-FR')} à {saleTime.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                            </div>
                          </td>

                          <td className="py-3 px-4">
                            <span className="font-semibold text-[#1F2421]">
                              {sale.sellerName || 'Utilisateur'}
                            </span>
                          </td>

                          <td className="py-3 px-4 max-w-xs">
                            <div className="space-y-0.5">
                              {(sale.items || []).map((it, idx) => (
                                <div key={idx} className="text-[11px] text-[#1F2421] truncate">
                                  <strong>{it.quantity}x</strong> {it.productName} ({it.packaging})
                                </div>
                              ))}
                            </div>
                          </td>

                          <td className="py-3 px-4">
                            <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                              isCash 
                                ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' 
                                : 'bg-amber-100 text-amber-800 border border-amber-200'
                            }`}>
                              {isCash ? <Coins className="w-3 h-3" /> : <Smartphone className="w-3 h-3" />}
                              {isCash ? 'Espèces' : 'Mobile Money'}
                            </span>
                          </td>

                          <td className="py-3 px-4 text-right font-bold text-sm text-[#1F2421]">
                            {sale.totalAmount.toLocaleString('fr-FR')} FCFA
                          </td>

                          <td className="py-3 px-4 text-right">
                            <span className="font-bold text-xs text-emerald-700">
                              +{saleProfit.toLocaleString('fr-FR')} F
                            </span>
                          </td>

                          <td className="py-3 px-4 text-center">
                            <button
                              type="button"
                              onClick={() => setInspectSale(sale)}
                              className="p-1.5 rounded-xl bg-[#F4F1E9] hover:bg-[#EFEAE1] text-[#294637] transition border border-[#E2DDD3] cursor-pointer"
                              title="Voir le ticket"
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal Reçu de Caisse après validation immédiate */}
      {completedSale && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-3xl bg-[#FAF8F5] border border-[#E2DDD3] p-6 shadow-2xl text-[#1F2421]">
            <div className="flex items-center justify-between pb-3 border-b border-[#E8E4DA] mb-3">
              <div className="flex items-center gap-2 text-emerald-700 font-bold text-sm">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                <span>Vente validée & enregistrée</span>
              </div>
              <button
                onClick={() => setCompletedSale(null)}
                className="p-1 rounded-lg text-[#6A726D] hover:bg-[#E8E4DA] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Aperçu du ticket */}
            <div className="p-4 rounded-2xl bg-[#F4F1E9] border border-[#E2DDD3] space-y-2 text-xs font-mono">
              <div className="text-center font-bold text-sm text-[#294637] font-sans pb-1 border-b border-[#E2DDD3]">
                GESTION BOISSONS
              </div>
              <div className="flex justify-between text-[11px] text-[#6A726D]">
                <span>Ticket #{completedSale.id.slice(-6).toUpperCase()}</span>
                <span>{completedSale.date}</span>
              </div>
              <div className="text-[11px] text-[#6A726D]">
                Vendeur : {completedSale.sellerName}
              </div>

              <div className="pt-2 border-t border-[#E2DDD3] space-y-1">
                {completedSale.items.map((it: SaleItem, i: number) => (
                  <div key={i} className="flex justify-between">
                    <span>{it.quantity}x {it.productName} ({it.packaging})</span>
                    <span className="font-bold">{it.totalPrice.toLocaleString('fr-FR')} F</span>
                  </div>
                ))}
              </div>

              <div className="pt-2 border-t border-[#E2DDD3] flex justify-between font-bold text-sm text-[#1F2421]">
                <span>TOTAL PAYÉ :</span>
                <span>{completedSale.totalAmount.toLocaleString('fr-FR')} FCFA</span>
              </div>
              <div className="text-[10px] text-[#6A726D] text-right">
                Mode : {PAYMENT_METHOD_LABELS[completedSale.paymentMethod as PaymentMethod]}
              </div>
            </div>

            <div className="flex gap-2 pt-4">
              <button
                onClick={() => window.print()}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-[#F4F1E9] border border-[#E2DDD3] text-xs font-bold text-[#1F2421] hover:bg-[#EFEAE1] transition cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>Imprimer</span>
              </button>
              <button
                onClick={() => setCompletedSale(null)}
                className="flex-1 py-2.5 rounded-xl bg-[#294637] text-xs font-bold text-[#FAF8F5] hover:bg-[#1E3429] transition cursor-pointer"
              >
                Nouvelle vente
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Consultation d'un ticket historique */}
      {inspectSale && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-3xl bg-[#FAF8F5] border border-[#E2DDD3] p-6 shadow-2xl text-[#1F2421]">
            <div className="flex items-center justify-between pb-3 border-b border-[#E8E4DA] mb-3">
              <div className="flex items-center gap-2 font-bold text-sm text-[#294637]">
                <ReceiptText className="w-5 h-5 text-[#294637]" />
                <span>Détail du Ticket #{inspectSale.id.slice(-6).toUpperCase()}</span>
              </div>
              <button
                onClick={() => setInspectSale(null)}
                className="p-1 rounded-lg text-[#6A726D] hover:bg-[#E8E4DA] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 rounded-2xl bg-[#F4F1E9] border border-[#E2DDD3] space-y-2 text-xs font-mono">
              <div className="text-center font-bold text-sm text-[#294637] font-sans pb-1 border-b border-[#E2DDD3]">
                GESTION BOISSONS
              </div>
              <div className="flex justify-between text-[11px] text-[#6A726D]">
                <span>Ticket #{inspectSale.id.slice(-6).toUpperCase()}</span>
                <span>{new Date(inspectSale.timestamp || inspectSale.createdAt || inspectSale.date).toLocaleString('fr-FR')}</span>
              </div>
              <div className="text-[11px] text-[#6A726D]">
                Vendeur : {inspectSale.sellerName || 'Utilisateur'}
              </div>

              <div className="pt-2 border-t border-[#E2DDD3] space-y-1">
                {(inspectSale.items || []).map((it: SaleItem, i: number) => (
                  <div key={i} className="flex justify-between">
                    <span>{it.quantity}x {it.productName} ({it.packaging})</span>
                    <span className="font-bold">{it.totalPrice.toLocaleString('fr-FR')} F</span>
                  </div>
                ))}
              </div>

              <div className="pt-2 border-t border-[#E2DDD3] flex justify-between font-bold text-sm text-[#1F2421]">
                <span>TOTAL :</span>
                <span>{inspectSale.totalAmount.toLocaleString('fr-FR')} FCFA</span>
              </div>
              <div className="text-[10px] text-[#6A726D] text-right">
                Paiement : {inspectSale.paymentMethod === 'mobile_money' ? 'Mobile Money' : 'Espèces'}
              </div>
            </div>

            <div className="flex gap-2 pt-4">
              <button
                onClick={() => window.print()}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-[#294637] text-xs font-bold text-white hover:bg-[#1E3429] transition cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>Imprimer ticket</span>
              </button>
              <button
                onClick={() => setInspectSale(null)}
                className="flex-1 py-2.5 rounded-xl bg-[#E8E4DA] text-xs font-bold text-[#1F2421] hover:bg-[#DDD8CD] transition cursor-pointer"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
