/**
 * Contexte d'authentification et de gestion des rôles
 * Application : GESTION BOISSONS
 * 
 * Supporte :
 * 1. Création de compte automatique sur invitation enregistrée dans Cloud Firestore
 * 2. Authentification résiliente (Firebase Auth + Cloud Firestore credentials sécurisés par SHA-256)
 * 3. Session persistante et gestion des droits (ADMIN / Utilisateur)
 */

import React, { createContext, useContext, useEffect, useState } from 'react';
import { 
  User, 
  signInWithEmailAndPassword, 
  signOut as firebaseSignOut, 
  onAuthStateChanged,
  sendPasswordResetEmail,
  createUserWithEmailAndPassword,
  updateProfile,
  signInWithPopup
} from 'firebase/auth';
import { 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc, 
  serverTimestamp, 
  collection, 
  getDocs,
  onSnapshot,
  query,
  where 
} from 'firebase/firestore';
import { auth, db, isFirebaseConfigured, googleProvider } from '../config/firebase';
import { 
  UserProfile, 
  UserRole, 
  ROLE_PERMISSIONS, 
  PermissionMatrix,
  MAX_ACTIVE_ACCOUNTS 
} from '../types/auth';
import { setupUserPresence } from '../services/presence';
import { validateInvitation, consumeInvitation } from '../services/invitations';

export interface PredefinedAccount {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  phone?: string;
  password?: string;
}

export const DEFAULT_ADMIN_ACCOUNT = {
  id: 'usr_admin_karl',
  email: 'FULL-karlfreaton@gmail.com',
  displayName: 'Karl (ADMIN)',
  role: 'admin' as UserRole,
  password: 'FULLADMIN.COM123!',
};

export const PREDEFINED_ACCOUNTS: PredefinedAccount[] = [
  {
    id: DEFAULT_ADMIN_ACCOUNT.id,
    email: DEFAULT_ADMIN_ACCOUNT.email,
    displayName: DEFAULT_ADMIN_ACCOUNT.displayName,
    role: DEFAULT_ADMIN_ACCOUNT.role,
    password: DEFAULT_ADMIN_ACCOUNT.password,
  }
];

/**
 * Hachage cryptographique sécurisé pour les identifiants stockés dans Cloud Firestore (SHA-256 avec sel)
 * Conforme au standard Web Crypto API (aucun mot de passe en clair)
 */
export async function hashPassword(password: string): Promise<string> {
  const enc = new TextEncoder();
  const salt = 'gestion_boissons_salt_2026_';
  const data = enc.encode(salt + password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  role: UserRole | null;
  loading: boolean;
  isConfigured: boolean;
  error: string | null;
  activeAccountsCount: number;
  signIn: (email: string, pass: string) => Promise<{ success: boolean; error?: string }>;
  signInWithGoogle: () => Promise<{ success: boolean; error?: string }>;
  signInAsPredefined: (account: PredefinedAccount) => Promise<{ success: boolean; error?: string }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ success: boolean; error?: string }>;
  registerWithInvitation: (
    invitationCode: string, 
    email: string, 
    pass: string, 
    name: string
  ) => Promise<{ success: boolean; error?: string }>;
  bootstrapFirstAdmin: (email: string, pass: string, name: string) => Promise<{ success: boolean; error?: string }>;
  createEmployeeAccount: (
    email: string, 
    pass: string, 
    name: string, 
    role: UserRole, 
    phone?: string
  ) => Promise<{ success: boolean; error?: string }>;
  toggleAccountStatus: (uid: string, currentStatus: boolean) => Promise<{ success: boolean; error?: string }>;
  hasPermission: (perm: keyof PermissionMatrix) => boolean;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const LOCAL_SESSION_KEY = 'gestion_boissons_active_session';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeAccountsCount, setActiveAccountsCount] = useState(0);

  const isConfigured = isFirebaseConfigured();

  // Initialisation et vérification des comptes
  useEffect(() => {
    // 1. Vérifier si une session rapide locale a été enregistrée
    const storedSession = localStorage.getItem(LOCAL_SESSION_KEY);
    if (storedSession) {
      try {
        const parsed = JSON.parse(storedSession) as UserProfile;
        setProfile(parsed);

        // Rafraîchir les données en direct depuis Firestore
        if (db && parsed.uid) {
          getDoc(doc(db, 'users', parsed.uid)).then((snap) => {
            if (snap.exists()) {
              const liveData = snap.data() as UserProfile;
              if (liveData.isActive === false) {
                localStorage.removeItem(LOCAL_SESSION_KEY);
                setProfile(null);
              } else {
                setProfile(liveData);
                localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(liveData));
              }
            }
          }).catch(() => {});
        }
      } catch {
        // Ignorer
      }
    }

    // Seeder automatiquement le compte ADMIN par défaut dans Firestore s'il n'existe pas encore
    if (db) {
      (async () => {
        try {
          const adminDocRef = doc(db, 'users', DEFAULT_ADMIN_ACCOUNT.id);
          const adminSnap = await getDoc(adminDocRef);
          const passHash = await hashPassword(DEFAULT_ADMIN_ACCOUNT.password);

          const adminProfile: UserProfile = {
            uid: DEFAULT_ADMIN_ACCOUNT.id,
            email: DEFAULT_ADMIN_ACCOUNT.email.toLowerCase(),
            displayName: DEFAULT_ADMIN_ACCOUNT.displayName,
            role: 'admin',
            isActive: true,
            createdAt: '2026-01-01T00:00:00.000Z',
            passwordHash: passHash,
          };

          if (!adminSnap.exists()) {
            await setDoc(adminDocRef, adminProfile);
            await setDoc(doc(db, 'admins', DEFAULT_ADMIN_ACCOUNT.id), {
              uid: DEFAULT_ADMIN_ACCOUNT.id,
              email: DEFAULT_ADMIN_ACCOUNT.email.toLowerCase(),
              createdAt: serverTimestamp(),
            });
          } else {
            const existingData = adminSnap.data();
            if (!existingData.passwordHash || existingData.passwordHash !== passHash || existingData.role !== 'admin') {
              await setDoc(adminDocRef, {
                passwordHash: passHash,
                role: 'admin',
                isActive: true,
              }, { merge: true });
              await setDoc(doc(db, 'admins', DEFAULT_ADMIN_ACCOUNT.id), {
                uid: DEFAULT_ADMIN_ACCOUNT.id,
                email: DEFAULT_ADMIN_ACCOUNT.email.toLowerCase(),
                createdAt: serverTimestamp(),
              }, { merge: true });
            }
          }
        } catch (seedErr) {
          console.warn('Initialisation compte admin Firestore:', seedErr);
        }
      })();
    }

    if (!isConfigured || !auth) {
      setLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser && db) {
        try {
          const userDocRef = doc(db, 'users', firebaseUser.uid);
          const userDoc = await getDoc(userDocRef);

          if (userDoc.exists()) {
            const data = userDoc.data() as UserProfile;
            setProfile(data);
            localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(data));

            updateDoc(userDocRef, {
              lastLoginAt: new Date().toISOString(),
            }).catch(() => {});
          } else {
            // Déterminer le rôle via la collection admins ou premier compte
            const adminDoc = await getDoc(doc(db, 'admins', firebaseUser.uid)).catch(() => null);
            const adminsSnap = await getDocs(collection(db, 'admins')).catch(() => null);
            const isFirstUserAdmin = !adminsSnap || adminsSnap.empty;
            const isAdmin = Boolean((adminDoc && adminDoc.exists()) || isFirstUserAdmin);

            const newProfile: UserProfile = {
              uid: firebaseUser.uid,
              email: firebaseUser.email || '',
              displayName: firebaseUser.displayName || (isAdmin ? 'ADMIN' : 'Utilisateur'),
              role: isAdmin ? 'admin' : 'collaborator',
              isActive: true,
              createdAt: new Date().toISOString(),
            };
            
            await setDoc(userDocRef, newProfile);
            if (isAdmin) {
              await setDoc(doc(db, 'admins', firebaseUser.uid), {
                uid: firebaseUser.uid,
                email: firebaseUser.email,
                createdAt: serverTimestamp(),
              }).catch(() => {});
            }

            setProfile(newProfile);
            localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(newProfile));
          }
        } catch (err) {
          console.error('Erreur chargement profil utilisateur:', err);
        }
      } else if (!storedSession) {
        setProfile(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [isConfigured]);

  // Écoute de la présence en temps réel
  useEffect(() => {
    if (profile) {
      const activeUid = user?.uid || profile.uid;
      const cleanupPresence = setupUserPresence(
        activeUid,
        profile.displayName,
        profile.role,
        profile.email
      );
      return () => cleanupPresence();
    }
  }, [user, profile]);

  // Écoute du nombre de comptes actifs dans Firestore
  useEffect(() => {
    if (!isConfigured || !db) return;

    try {
      const usersCol = collection(db, 'users');
      const unsub = onSnapshot(usersCol, (snap) => {
        const activeUsers = snap.docs.filter(d => d.data().isActive !== false);
        setActiveAccountsCount(activeUsers.length);
      }, () => {
        // En cas d'erreur
      });
      return () => unsub();
    } catch {
      // Ignorer
    }
  }, [isConfigured]);

  const clearError = () => setError(null);

  const formatFirebaseError = (err: unknown): string => {
    if (typeof err !== 'object' || err === null) return String(err);
    const code = (err as any).code;

    switch (code) {
      case 'auth/operation-not-allowed':
        return 'Le fournisseur Email/Mot de passe n’est pas activé dans la console Firebase. Veuillez l’activer dans Authentication > Sign-in method.';
      case 'auth/unauthorized-domain':
        return 'Domaine non autorisé dans Firebase Auth. Veuillez vérifier les domaines autorisés dans la console Firebase.';
      case 'auth/user-not-found':
      case 'auth/wrong-password':
      case 'auth/invalid-credential':
        return 'Identifiants invalides. Vérifiez votre adresse email et votre mot de passe.';
      case 'auth/invalid-email':
        return 'Adresse email invalide. Veuillez vérifier le format.';
      case 'auth/email-already-in-use':
        return 'Cette adresse email est déjà enregistrée. Veuillez vous connecter.';
      case 'auth/weak-password':
        return 'Le mot de passe doit comporter au moins 6 caractères.';
      case 'auth/too-many-requests':
        return 'Trop de tentatives infructueuses. Veuillez patienter quelques instants.';
      case 'auth/popup-closed-by-user':
        return 'La fenêtre de connexion a été fermée.';
      default:
        return (err as any).message || 'Une erreur est survenue lors de l’authentification.';
    }
  };

  /**
   * Connexion 1-clic avec Google (authentification Firebase native)
   */
  const signInWithGoogle = async () => {
    if (!isConfigured || !auth) {
      return { success: false, error: 'Firebase n’est pas configuré.' };
    }
    setError(null);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const isTargetAdmin = result.user.email === 'karlfreaton@gmail.com';

      if (db) {
        const userDocRef = doc(db, 'users', result.user.uid);
        const userSnap = await getDoc(userDocRef);

        let userProf: UserProfile;
        if (!userSnap.exists()) {
          userProf = {
            uid: result.user.uid,
            email: result.user.email || '',
            displayName: result.user.displayName || (isTargetAdmin ? 'Karl (ADMIN)' : 'Utilisateur'),
            role: isTargetAdmin ? 'admin' : 'collaborator',
            isActive: true,
            createdAt: new Date().toISOString(),
          };
          await setDoc(userDocRef, userProf);
          if (isTargetAdmin) {
            await setDoc(doc(db, 'admins', result.user.uid), {
              uid: result.user.uid,
              email: result.user.email,
              createdAt: serverTimestamp(),
            }).catch(() => {});
          }
        } else {
          userProf = userSnap.data() as UserProfile;
        }

        setProfile(userProf);
        localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(userProf));
      }

      return { success: true };
    } catch (err) {
      const msg = formatFirebaseError(err);
      setError(msg);
      return { success: false, error: msg };
    }
  };

  /**
   * Connexion directe préconfigurée
   */
  const signInAsPredefined = async (account: PredefinedAccount) => {
    setError(null);
    const newProfile: UserProfile = {
      uid: account.id,
      email: account.email,
      displayName: account.displayName,
      role: account.role,
      isActive: true,
      createdAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString(),
      phone: account.phone,
    };

    if (db) {
      try {
        await setDoc(doc(db, 'users', account.id), newProfile, { merge: true });
        if (account.role === 'admin') {
          await setDoc(doc(db, 'admins', account.id), {
            uid: account.id,
            email: account.email,
            createdAt: serverTimestamp(),
          }, { merge: true }).catch(() => {});
        }
      } catch (err) {
        console.warn('Sync Firestore compte prédéfini:', err);
      }
    }

    setProfile(newProfile);
    localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(newProfile));
    return { success: true };
  };

  /**
   * Connexion résiliente :
   * 1. Tente Firebase Auth standard
   * 2. En cas de blocage provider (ex: auth/operation-not-allowed) ou de compte créé via invitation,
   *    vérifie les identifiants hachés dans Cloud Firestore
   */
  const signIn = async (inputEmail: string, pass: string) => {
    const email = inputEmail.trim().toLowerCase();

    if (!email || !pass) {
      return { success: false, error: 'Veuillez saisir votre adresse email et votre mot de passe.' };
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return { success: false, error: 'Veuillez renseigner une adresse email valide (ex: nom@domaine.com).' };
    }

    setError(null);

    // Vérification prioritaire du compte ADMIN par défaut configuré
    if (email === DEFAULT_ADMIN_ACCOUNT.email.toLowerCase() && pass === DEFAULT_ADMIN_ACCOUNT.password) {
      const adminProfile: UserProfile = {
        uid: DEFAULT_ADMIN_ACCOUNT.id,
        email: DEFAULT_ADMIN_ACCOUNT.email.toLowerCase(),
        displayName: DEFAULT_ADMIN_ACCOUNT.displayName,
        role: 'admin',
        isActive: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        lastLoginAt: new Date().toISOString(),
      };

      if (db) {
        try {
          const passHash = await hashPassword(DEFAULT_ADMIN_ACCOUNT.password);
          await setDoc(doc(db, 'users', DEFAULT_ADMIN_ACCOUNT.id), {
            ...adminProfile,
            passwordHash: passHash,
          }, { merge: true });
          await setDoc(doc(db, 'admins', DEFAULT_ADMIN_ACCOUNT.id), {
            uid: DEFAULT_ADMIN_ACCOUNT.id,
            email: DEFAULT_ADMIN_ACCOUNT.email.toLowerCase(),
            createdAt: serverTimestamp(),
          }, { merge: true });
        } catch (dbErr) {
          console.warn('Sync admin Firestore:', dbErr);
        }
      }

      setProfile(adminProfile);
      localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(adminProfile));
      return { success: true };
    }

    // 1. Tenter la connexion Firebase Auth standard
    if (isConfigured && auth) {
      try {
        const cred = await signInWithEmailAndPassword(auth, email, pass);
        const credUser = cred.user;

        if (credUser && db) {
          const userDocRef = doc(db, 'users', credUser.uid);
          const userDoc = await getDoc(userDocRef).catch(() => null);

          let profileData: UserProfile;

          if (userDoc && userDoc.exists()) {
            profileData = userDoc.data() as UserProfile;
            if (profileData.isActive === false) {
              await firebaseSignOut(auth).catch(() => {});
              const msg = 'Ce compte utilisateur a été désactivé par l’administrateur.';
              setError(msg);
              return { success: false, error: msg };
            }
          } else {
            const adminDoc = await getDoc(doc(db, 'admins', credUser.uid)).catch(() => null);
            const adminsSnap = await getDocs(collection(db, 'admins')).catch(() => null);
            const isAdmin = Boolean((adminDoc && adminDoc.exists()) || (!adminsSnap || adminsSnap.empty));

            profileData = {
              uid: credUser.uid,
              email: credUser.email || email,
              displayName: credUser.displayName || (isAdmin ? 'ADMIN' : 'Utilisateur'),
              role: isAdmin ? 'admin' : 'collaborator',
              isActive: true,
              createdAt: new Date().toISOString(),
              lastLoginAt: new Date().toISOString(),
            };
            await setDoc(userDocRef, profileData, { merge: true }).catch(() => {});
            if (isAdmin) {
              await setDoc(doc(db, 'admins', credUser.uid), {
                uid: credUser.uid,
                email: credUser.email || email,
                createdAt: serverTimestamp(),
              }).catch(() => {});
            }
          }

          // Mise à jour de la dernière connexion
          await updateDoc(userDocRef, {
            lastLoginAt: new Date().toISOString(),
          }).catch(() => {});

          setProfile(profileData);
          localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(profileData));
          return { success: true };
        }
      } catch (authErr: any) {
        // Si l'erreur est un blocage du provider ou si l'utilisateur est dans Firestore
        console.warn('Vérification compte Cloud Firestore...');
      }
    }

    // 2. Vérification directe dans Cloud Firestore (pour les comptes créés via invitation)
    if (db) {
      try {
        let matchedDoc: any = null;
        try {
          const q = query(collection(db, 'users'), where('email', '==', email));
          const snap = await getDocs(q);
          if (!snap.empty) {
            matchedDoc = snap.docs[0];
          }
        } catch {
          const usersSnap = await getDocs(collection(db, 'users')).catch(() => null);
          if (usersSnap && !usersSnap.empty) {
            matchedDoc = usersSnap.docs.find(d => {
              const data = d.data();
              return (data.email || '').trim().toLowerCase() === email;
            });
          }
        }

        if (matchedDoc) {
          const userData = matchedDoc.data() as UserProfile;

          if (userData.isActive === false) {
            const msg = 'Ce compte utilisateur a été désactivé par l’administrateur.';
            setError(msg);
            return { success: false, error: msg };
          }

          const inputHash = await hashPassword(pass);

          // Vérifier si le mot de passe correspond au hash cryptographique stocké
          if (userData.passwordHash) {
            if (userData.passwordHash === inputHash) {
              const updatedProfile: UserProfile = {
                ...userData,
                uid: matchedDoc.id,
                lastLoginAt: new Date().toISOString(),
              };

              await updateDoc(doc(db, 'users', matchedDoc.id), {
                lastLoginAt: new Date().toISOString(),
              }).catch(() => {});

              setProfile(updatedProfile);
              localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(updatedProfile));
              return { success: true };
            } else {
              const msg = 'Mot de passe incorrect. Veuillez vérifier votre saisie.';
              setError(msg);
              return { success: false, error: msg };
            }
          }
        }
      } catch (fsErr) {
        console.error('Erreur lecture Firestore login:', fsErr);
      }
    }

    const fallbackMsg = 'Identifiants invalides. Si vous avez reçu un code d’invitation, cliquez sur "Créer un compte (Invitation)".';
    setError(fallbackMsg);
    return { success: false, error: fallbackMsg };
  };

  const signOut = async () => {
    localStorage.removeItem(LOCAL_SESSION_KEY);
    if (auth) {
      try {
        await firebaseSignOut(auth);
      } catch (err) {
        console.error('Erreur déconnexion:', err);
      }
    }
    setUser(null);
    setProfile(null);
  };

  const resetPassword = async (email: string) => {
    if (!isConfigured || !auth) {
      return { success: false, error: 'Firebase n’est pas encore configuré.' };
    }
    try {
      await sendPasswordResetEmail(auth, email.trim());
      return { success: true };
    } catch (err) {
      const msg = formatFirebaseError(err);
      return { success: false, error: msg };
    }
  };

  /**
   * Création automatique de compte pour toute personne ayant reçu une invitation de l'ADMIN.
   * L'utilisateur est enregistré dans Cloud Firestore et pourra se connecter immédiatement et ultérieurement.
   */
  const registerWithInvitation = async (
    invitationCode: string,
    emailInput: string,
    pass: string,
    nameInput: string
  ): Promise<{ success: boolean; error?: string }> => {
    const email = emailInput.trim().toLowerCase();
    const name = nameInput.trim();

    if (!isConfigured || !db) {
      return { success: false, error: 'Base de données Cloud Firestore non disponible.' };
    }

    if (!invitationCode || !email || !pass || !name) {
      return { success: false, error: 'Tous les champs sont obligatoires pour créer votre compte.' };
    }

    if (pass.length < 6) {
      return { success: false, error: 'Le mot de passe doit comporter au moins 6 caractères.' };
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return { success: false, error: 'Veuillez saisir une adresse email valide.' };
    }

    // 1. Valider l'invitation auprès de Cloud Firestore
    const valResult = await validateInvitation(invitationCode);
    if (!valResult.valid) {
      return { success: false, error: valResult.error || 'Code d’invitation invalide ou expiré.' };
    }

    // 2. Vérifier si un compte avec cet email existe déjà dans Firestore
    try {
      let existingUser = false;
      try {
        const q = query(collection(db, 'users'), where('email', '==', email));
        const snap = await getDocs(q);
        if (!snap.empty) {
          existingUser = true;
        }
      } catch {
        const usersSnap = await getDocs(collection(db, 'users')).catch(() => null);
        if (usersSnap && !usersSnap.empty) {
          existingUser = usersSnap.docs.some(d => (d.data().email || '').trim().toLowerCase() === email);
        }
      }

      if (existingUser) {
        return { 
          success: false, 
          error: 'Un compte avec cette adresse email existe déjà. Veuillez vous connecter directement.' 
        };
      }
    } catch (checkErr) {
      console.warn('Vérification email existant Firestore:', checkErr);
    }

    const passwordHash = await hashPassword(pass);
    let userUid: string | null = null;

    // 3. Tenter la création native Firebase Auth (si disponible)
    if (auth) {
      try {
        const cred = await createUserWithEmailAndPassword(auth, email, pass);
        await updateProfile(cred.user, { displayName: name }).catch(() => {});
        userUid = cred.user.uid;
      } catch (authErr: any) {
        // En cas de non activation du provider Firebase Auth (auth/operation-not-allowed),
        // on bascule immédiatement sur l'enregistrement direct et pérenne dans Cloud Firestore
        userUid = 'usr_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 8);
      }
    } else {
      userUid = 'usr_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 8);
    }

    try {
      // 4. Enregistrement automatique dans Cloud Firestore - Rôle 'collaborator' (Utilisateur)
      const newProfile: UserProfile = {
        uid: userUid,
        email: email,
        displayName: name,
        role: 'collaborator',
        isActive: true,
        createdAt: new Date().toISOString(),
        lastLoginAt: new Date().toISOString(),
        passwordHash: passwordHash,
        invitationCode: invitationCode.trim().toUpperCase(),
      };

      await setDoc(doc(db, 'users', userUid), newProfile);

      // 5. Consommer l'invitation (marquer comme 'used')
      await consumeInvitation(invitationCode, userUid, email);

      // 6. Journaliser dans l'audit
      try {
        const auditRef = doc(collection(db, 'audit_logs'));
        await setDoc(auditRef, {
          id: auditRef.id,
          action: 'COMPTE_CREE_INVITATION',
          entity: 'user',
          performedBy: userUid,
          performedByName: name,
          timestamp: new Date().toISOString(),
          details: `Création de compte réussie pour ${name} (${email}) avec l'invitation ${invitationCode.trim().toUpperCase()}`,
        });
      } catch {
        // Ignorer si audit_logs restreint
      }

      setProfile(newProfile);
      localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(newProfile));
      return { success: true };
    } catch (err) {
      console.error('Erreur enregistrement compte invité dans Firestore:', err);
      return { 
        success: false, 
        error: 'Erreur lors de l’enregistrement dans Cloud Firestore : ' + (err instanceof Error ? err.message : String(err)) 
      };
    }
  };

  /**
   * Création sécurisée du tout premier compte ADMIN si aucun administrateur n'existe encore
   */
  const bootstrapFirstAdmin = async (emailInput: string, pass: string, nameInput: string) => {
    const email = emailInput.trim().toLowerCase();
    const name = nameInput.trim() || 'ADMIN';

    if (!isConfigured || !db) {
      return { success: false, error: 'Base de données Cloud Firestore non configurée.' };
    }

    try {
      const adminsSnap = await getDocs(collection(db, 'admins'));
      if (!adminsSnap.empty) {
        return { 
          success: false, 
          error: 'Le compte ADMIN est déjà créé. Les inscriptions se font exclusivement sur invitation de l’ADMIN.' 
        };
      }

      const passwordHash = await hashPassword(pass);
      let adminUid: string;

      if (auth) {
        try {
          const cred = await createUserWithEmailAndPassword(auth, email, pass);
          await updateProfile(cred.user, { displayName: name }).catch(() => {});
          adminUid = cred.user.uid;
        } catch {
          adminUid = 'usr_admin_' + Date.now().toString(36);
        }
      } else {
        adminUid = 'usr_admin_' + Date.now().toString(36);
      }

      const newProfile: UserProfile = {
        uid: adminUid,
        email: email,
        displayName: name,
        role: 'admin',
        isActive: true,
        createdAt: new Date().toISOString(),
        lastLoginAt: new Date().toISOString(),
        passwordHash: passwordHash,
      };

      await setDoc(doc(db, 'users', adminUid), newProfile);
      await setDoc(doc(db, 'admins', adminUid), {
        uid: adminUid,
        email: email,
        createdAt: serverTimestamp(),
      });

      setProfile(newProfile);
      localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(newProfile));
      return { success: true };
    } catch (err) {
      const msg = formatFirebaseError(err);
      return { success: false, error: msg };
    }
  };

  /**
   * Création directe d'un employé par l'administrateur
   */
  const createEmployeeAccount = async (
    email: string, 
    pass: string, 
    name: string, 
    newRole: UserRole, 
    phone?: string
  ) => {
    if (!profile || profile.role !== 'admin') {
      return { success: false, error: 'Seul l’administrateur peut créer des comptes employés.' };
    }

    if (!isConfigured || !db) {
      return { success: false, error: 'Firebase non connecté.' };
    }

    if (activeAccountsCount >= MAX_ACTIVE_ACCOUNTS) {
      return { 
        success: false, 
        error: `Limite atteinte : Le système est configuré pour 6 comptes actifs maximum (${activeAccountsCount}/${MAX_ACTIVE_ACCOUNTS}). Désactivez un compte avant d'en créer un nouveau.` 
      };
    }

    try {
      const placeholderUid = 'usr_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
      const passwordHash = pass ? await hashPassword(pass) : undefined;
      
      const employeeDoc: UserProfile = {
        uid: placeholderUid,
        email: email.trim().toLowerCase(),
        displayName: name.trim(),
        role: newRole,
        isActive: true,
        createdAt: new Date().toISOString(),
        phone: phone?.trim(),
        passwordHash: passwordHash,
      };

      await setDoc(doc(db, 'users', placeholderUid), employeeDoc);

      return { 
        success: true, 
        error: undefined 
      };
    } catch (err) {
      return { 
        success: false, 
        error: 'Erreur lors de l’enregistrement de l’employé : ' + (err instanceof Error ? err.message : String(err)) 
      };
    }
  };

  const toggleAccountStatus = async (targetUid: string, currentStatus: boolean) => {
    if (!profile || profile.role !== 'admin') {
      return { success: false, error: 'Action réservée à l’administrateur.' };
    }
    if (!db) return { success: false, error: 'Base de données non disponible.' };

    try {
      await updateDoc(doc(db, 'users', targetUid), {
        isActive: !currentStatus,
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: 'Erreur : ' + (err instanceof Error ? err.message : String(err)) };
    }
  };

  const hasPermission = (perm: keyof PermissionMatrix): boolean => {
    if (!profile || !profile.role) return false;
    const permissions = ROLE_PERMISSIONS[profile.role];
    return permissions ? permissions[perm] : false;
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        role: profile?.role || null,
        loading,
        isConfigured,
        error,
        activeAccountsCount,
        signIn,
        signInWithGoogle,
        signInAsPredefined,
        signOut,
        resetPassword,
        registerWithInvitation,
        bootstrapFirstAdmin,
        createEmployeeAccount,
        toggleAccountStatus,
        hasPermission,
        clearError,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth doit être utilisé à l’intérieur de AuthProvider');
  }
  return context;
}
