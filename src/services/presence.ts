/**
 * Service de gestion de la présence en temps réel façon Messenger
 * Synchronisation instantanée multi-appareils et multi-utilisateurs via Cloud Firestore
 * Application : GESTION BOISSONS
 */

import { db, rtdb } from '../config/firebase';
import { 
  doc, 
  setDoc, 
  updateDoc, 
  collection, 
  onSnapshot, 
  serverTimestamp as firestoreTimestamp 
} from 'firebase/firestore';
import { 
  ref, 
  onValue, 
  onDisconnect, 
  set, 
  push,
  remove,
  serverTimestamp as rtdbTimestamp,
  DatabaseReference
} from 'firebase/database';
import { UserPresence, UserRole } from '../types/auth';

const HEARTBEAT_INTERVAL_MS = 15000; // 15 secondes
const OFFLINE_TIMEOUT_MS = 45000;    // 45 secondes de grâce

/**
 * Configure la présence en direct pour l'utilisateur connecté avec gestion multi-appareils
 * Synchronisation en temps réel sur tous les appareils connectés
 */
export function setupUserPresence(
  uid: string, 
  displayName: string, 
  role: UserRole, 
  email: string
): () => void {
  if (!uid) return () => {};

  let heartbeatTimer: any = null;
  let myRtdbSessionRef: DatabaseReference | null = null;

  // 1. Mise à jour Cloud Firestore (système universel et fiable)
  if (db) {
    try {
      const presenceDocRef = doc(db, 'presence', uid);
      const userDocRef = doc(db, 'users', uid);

      const writeOnlineState = (isOnline: boolean) => {
        if (!db) return;
        const now = Date.now();
        const payload: Record<string, any> = {
          uid,
          displayName: displayName || 'Utilisateur',
          role: role || 'collaborator',
          email: email || '',
          isOnline,
          lastHeartbeat: now,
          updatedAt: new Date().toISOString(),
        };

        setDoc(presenceDocRef, payload, { merge: true }).catch((err) => {
          console.warn('Erreur mise à jour présence Firestore:', err);
        });

        updateDoc(userDocRef, {
          isOnline,
          lastSeenAt: firestoreTimestamp(),
        }).catch(() => {});
      };

      // Connexion initiale : état en ligne
      writeOnlineState(true);

      // Battement de cœur périodique (heartbeat) pour certifier la présence active
      heartbeatTimer = setInterval(() => {
        writeOnlineState(true);
      }, HEARTBEAT_INTERVAL_MS);

      // Gestionnaire de fermeture de l'onglet ou navigation
      const handleBeforeUnload = () => {
        writeOnlineState(false);
      };
      window.addEventListener('beforeunload', handleBeforeUnload);

      // 2. Intégration Realtime Database si configurée
      if (rtdb) {
        try {
          const connectedRef = ref(rtdb, '.info/connected');
          const userSessionsRef = ref(rtdb, `presence_sessions/${uid}`);
          const presenceMetaRef = ref(rtdb, `presence_users/${uid}`);

          onValue(connectedRef, (snap) => {
            if (snap.val() === true) {
              myRtdbSessionRef = push(userSessionsRef);
              onDisconnect(myRtdbSessionRef).remove().catch(() => {});
              set(myRtdbSessionRef, {
                connectedAt: rtdbTimestamp(),
                userAgent: typeof navigator !== 'undefined' ? navigator.userAgent.substring(0, 50) : '',
              }).catch(() => {});

              set(presenceMetaRef, {
                uid,
                displayName,
                email,
                role,
                lastActive: rtdbTimestamp(),
              }).catch(() => {});
            }
          });
        } catch (rtdbErr) {
          console.warn('RTDB non configuré, repli sur Firestore:', rtdbErr);
        }
      }

      // Nettoyage lors de la déconnexion
      return () => {
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
        window.removeEventListener('beforeunload', handleBeforeUnload);
        writeOnlineState(false);

        if (myRtdbSessionRef) {
          remove(myRtdbSessionRef).catch(() => {});
          myRtdbSessionRef = null;
        }
      };
    } catch (err) {
      console.warn('Erreur initialisation setupUserPresence:', err);
    }
  }

  return () => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
  };
}

/**
 * Écoute la liste des utilisateurs réellement connectés en direct (synchronisation multi-appareils)
 */
export function listenToOnlineUsers(callback: (onlineUsers: UserPresence[]) => void): () => void {
  const rtdbUsers = new Map<string, UserPresence>();
  const firestoreUsers = new Map<string, UserPresence>();

  const emitMerged = () => {
    const combined = new Map<string, UserPresence>();
    firestoreUsers.forEach((val, key) => combined.set(key, val));
    rtdbUsers.forEach((val, key) => combined.set(key, val));
    callback(Array.from(combined.values()));
  };

  let unsubFirestore: (() => void) | null = null;
  let unsubRtdbSessions: (() => void) | null = null;
  let unsubRtdbMeta: (() => void) | null = null;

  // 1. Écoute Cloud Firestore (robuste et persistant)
  if (db) {
    try {
      const presenceCol = collection(db, 'presence');
      unsubFirestore = onSnapshot(presenceCol, (snapshot) => {
        const now = Date.now();
        firestoreUsers.clear();

        snapshot.docs.forEach((docSnap) => {
          const d = docSnap.data();
          const lastHb = typeof d.lastHeartbeat === 'number' ? d.lastHeartbeat : 0;
          const isRecent = (now - lastHb) < OFFLINE_TIMEOUT_MS;

          if (d.isOnline === true && isRecent) {
            firestoreUsers.set(docSnap.id, {
              uid: docSnap.id,
              displayName: d.displayName || 'Utilisateur',
              email: d.email || '',
              role: (d.role as UserRole) || 'collaborator',
              isOnline: true,
              lastSeen: lastHb || now,
            });
          }
        });

        emitMerged();
      }, (err) => {
        console.warn('Erreur listener Firestore presence:', err);
      });
    } catch (err) {
      console.warn('Erreur attachement Firestore presence:', err);
    }
  }

  // 2. Écoute Realtime Database (cave-17421) si configurée
  if (rtdb) {
    try {
      const sessionsRoot = ref(rtdb, 'presence_sessions');
      const usersMetaRoot = ref(rtdb, 'presence_users');
      let metaCache: Record<string, any> = {};

      unsubRtdbMeta = onValue(usersMetaRoot, (snap) => {
        metaCache = snap.val() || {};
      });

      unsubRtdbSessions = onValue(sessionsRoot, (snapshot) => {
        const val = snapshot.val();
        rtdbUsers.clear();
        if (val) {
          Object.keys(val).forEach((uid) => {
            const sessions = val[uid];
            if (sessions && typeof sessions === 'object' && Object.keys(sessions).length > 0) {
              const meta = metaCache[uid] || {};
              rtdbUsers.set(uid, {
                uid,
                displayName: meta.displayName || 'Utilisateur',
                email: meta.email || '',
                role: (meta.role as UserRole) || 'collaborator',
                isOnline: true,
                lastSeen: Date.now(),
              });
            }
          });
        }
        emitMerged();
      }, (err) => {
        console.warn('Erreur listener RTDB sessions:', err);
      });
    } catch (err) {
      console.warn('Erreur attachement RTDB:', err);
    }
  }

  return () => {
    if (unsubFirestore) unsubFirestore();
    if (unsubRtdbSessions) unsubRtdbSessions();
    if (unsubRtdbMeta) unsubRtdbMeta();
  };
}
