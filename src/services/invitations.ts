/**
 * Service de gestion des invitations d'inscription
 * Règle métier : Inscription UNIQUEMENT sur invitation créée par l'ADMIN.
 * Chaque code est unique, utilisable une seule fois et révocable.
 * Limite stricte : 6 comptes au total.
 * Application : GESTION BOISSONS
 */

import { db } from '../config/firebase';
import { 
  collection, 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc, 
  onSnapshot, 
  query, 
  orderBy, 
  getDocs,
  serverTimestamp 
} from 'firebase/firestore';
import { MAX_ACTIVE_ACCOUNTS } from '../types/auth';

export interface Invitation {
  id: string;
  code: string;
  createdAt: string;
  createdBy: string;
  createdByName: string;
  status: 'active' | 'used' | 'revoked';
  usedAt?: string;
  usedByEmail?: string;
  usedByUid?: string;
}

/**
 * Génère un code d'invitation aléatoire unique (ex: INV-8K3P9M)
 */
function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let randomPart = '';
  for (let i = 0; i < 6; i++) {
    randomPart += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `INV-${randomPart}`;
}

/**
 * Création d'une invitation par l'ADMIN
 */
export async function createInvitation(
  adminUid: string, 
  adminName: string
): Promise<{ success: boolean; code?: string; error?: string }> {
  if (!db) {
    return { success: false, error: 'Base de données non disponible.' };
  }

  try {
    // Vérifier la limite des 6 comptes
    const usersCol = collection(db, 'users');
    const usersSnap = await getDocs(usersCol);
    const activeCount = usersSnap.docs.filter(d => d.data().isActive !== false).length;

    if (activeCount >= MAX_ACTIVE_ACCOUNTS) {
      return {
        success: false,
        error: `Limite atteinte : le système est configuré pour ${MAX_ACTIVE_ACCOUNTS} comptes actifs au maximum (${activeCount}/${MAX_ACTIVE_ACCOUNTS}).`,
      };
    }

    const code = generateCode();
    const invRef = doc(db, 'invitations', code);

    const newInvitation: Invitation = {
      id: code,
      code,
      createdAt: new Date().toISOString(),
      createdBy: adminUid,
      createdByName: adminName,
      status: 'active',
    };

    await setDoc(invRef, newInvitation);

    // Enregistrement dans le journal d'audit
    try {
      const auditRef = doc(collection(db, 'audit_logs'));
      await setDoc(auditRef, {
        id: auditRef.id,
        action: 'INVITATION_CREEE',
        entity: 'user',
        performedBy: adminUid,
        performedByName: adminName,
        timestamp: new Date().toISOString(),
        details: `Invitation générée avec le code : ${code}`,
      });
    } catch {
      // Ignorer si journal audit inaccessible
    }

    return { success: true, code };
  } catch (err) {
    return { 
      success: false, 
      error: err instanceof Error ? err.message : String(err) 
    };
  }
}

/**
 * Révoque une invitation active
 */
export async function revokeInvitation(
  code: string, 
  adminUid: string, 
  adminName: string
): Promise<{ success: boolean; error?: string }> {
  if (!db) return { success: false, error: 'Base de données non disponible.' };

  try {
    const invRef = doc(db, 'invitations', code);
    await updateDoc(invRef, {
      status: 'revoked',
      revokedAt: new Date().toISOString(),
      revokedBy: adminUid,
    });

    try {
      const auditRef = doc(collection(db, 'audit_logs'));
      await setDoc(auditRef, {
        id: auditRef.id,
        action: 'INVITATION_REVOQUEE',
        entity: 'user',
        performedBy: adminUid,
        performedByName: adminName,
        timestamp: new Date().toISOString(),
        details: `Invitation révoquée : ${code}`,
      });
    } catch {
      // Ignorer
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Vérifie la validité d'un code d'invitation saisi
 */
export async function validateInvitation(
  rawCode: string
): Promise<{ valid: boolean; error?: string; invitation?: Invitation }> {
  if (!db) {
    return { valid: false, error: 'Base de données non disponible.' };
  }

  const cleanCode = rawCode.trim().toUpperCase();
  if (!cleanCode) {
    return { valid: false, error: 'Veuillez saisir un code d’invitation.' };
  }

  try {
    const invRef = doc(db, 'invitations', cleanCode);
    const invSnap = await getDoc(invRef);

    if (!invSnap.exists()) {
      return { valid: false, error: 'Code d’invitation introuvable ou incorrect.' };
    }

    const data = invSnap.data() as Invitation;

    if (data.status === 'used') {
      return { valid: false, error: 'Ce code d’invitation a déjà été utilisé.' };
    }

    if (data.status === 'revoked') {
      return { valid: false, error: 'Ce code d’invitation a été révoqué par l’administrateur.' };
    }

    if (data.status !== 'active') {
      return { valid: false, error: 'Ce code d’invitation n’est plus actif.' };
    }

    // Vérifier la capacité des 6 comptes
    const usersCol = collection(db, 'users');
    const usersSnap = await getDocs(usersCol);
    const activeCount = usersSnap.docs.filter(d => d.data().isActive !== false).length;

    if (activeCount >= MAX_ACTIVE_ACCOUNTS) {
      return { 
        valid: false, 
        error: `La boutique a atteint sa limite maximale de ${MAX_ACTIVE_ACCOUNTS} comptes.` 
      };
    }

    return { valid: true, invitation: data };
  } catch (err) {
    return { 
      valid: false, 
      error: 'Erreur lors de la vérification du code : ' + (err instanceof Error ? err.message : String(err)) 
    };
  }
}

/**
 * Marque l'invitation comme utilisée après inscription réussie
 */
export async function consumeInvitation(
  rawCode: string, 
  userUid: string, 
  userEmail: string
): Promise<{ success: boolean; error?: string }> {
  if (!db) return { success: false, error: 'Base de données non disponible.' };

  const cleanCode = rawCode.trim().toUpperCase();
  try {
    const invRef = doc(db, 'invitations', cleanCode);
    await updateDoc(invRef, {
      status: 'used',
      usedAt: new Date().toISOString(),
      usedByUid: userUid,
      usedByEmail: userEmail,
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Écoute la liste des invitations pour l'ADMIN
 */
export function listenToInvitations(callback: (list: Invitation[]) => void): () => void {
  if (!db) {
    callback([]);
    return () => {};
  }

  try {
    const invCol = collection(db, 'invitations');
    const q = query(invCol, orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ ...(d.data() as Invitation), id: d.id }));
      callback(list);
    }, (err) => {
      console.warn('Erreur listener invitations:', err);
      callback([]);
    });
    return unsub;
  } catch {
    callback([]);
    return () => {};
  }
}
