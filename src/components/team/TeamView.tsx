/**
 * Gestion de l'équipe, des invitations et des accès (Max 6 comptes au total)
 * RÈGLE MÉTIER : Inscription UNIQUEMENT sur invitation de l'ADMIN
 * Rôles : ADMIN et Utilisateur
 * Application : GESTION BOISSONS
 */

import React, { useEffect, useState } from 'react';
import { useAuth, PREDEFINED_ACCOUNTS } from '../../context/AuthContext';
import { 
  UserProfile, 
  UserRole, 
  ROLE_DEFINITIONS, 
  MAX_ACTIVE_ACCOUNTS 
} from '../../types/auth';
import { db } from '../../config/firebase';
import { collection, onSnapshot, query, orderBy, setDoc, doc, serverTimestamp } from 'firebase/firestore';
import { 
  createInvitation, 
  revokeInvitation, 
  listenToInvitations, 
  Invitation 
} from '../../services/invitations';
import { 
  Users, 
  UserPlus, 
  ShieldCheck, 
  CheckCircle2, 
  AlertCircle, 
  Check, 
  X, 
  Clock, 
  Sparkles,
  Phone,
  Mail,
  Ticket,
  Copy,
  Trash2
} from 'lucide-react';

export const TeamView: React.FC = () => {
  const { profile, activeAccountsCount, toggleAccountStatus } = useAuth();
  
  const [usersList, setUsersList] = useState<UserProfile[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);

  // Invitations
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [generatingInvite, setGeneratingInvite] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [inviteFeedback, setInviteFeedback] = useState<{ success: boolean; msg: string } | null>(null);

  const isAdmin = profile?.role === 'admin';

  // Écoute des utilisateurs dans Firestore
  useEffect(() => {
    if (!db) {
      setLoadingUsers(false);
      return;
    }

    try {
      const usersRef = collection(db, 'users');
      const q = query(usersRef, orderBy('createdAt', 'desc'));

      const unsubscribe = onSnapshot(q, async (snapshot) => {
        if (snapshot.empty && db) {
          const firestore = db;
          // Initialisation automatique des comptes de base
          try {
            for (const acc of PREDEFINED_ACCOUNTS) {
              await setDoc(doc(firestore, 'users', acc.id), {
                uid: acc.id,
                email: acc.email,
                displayName: acc.displayName,
                role: acc.role,
                isActive: true,
                createdAt: new Date().toISOString(),
                phone: acc.phone,
              });
              if (acc.role === 'admin') {
                await setDoc(doc(firestore, 'admins', acc.id), {
                  uid: acc.id,
                  email: acc.email,
                  createdAt: serverTimestamp(),
                }).catch(() => {});
              }
            }
          } catch (seedErr) {
            console.warn('Auto-seed comptes:', seedErr);
          }
        }

        const loaded: UserProfile[] = snapshot.docs.map((docSnap) => {
          const d = docSnap.data();
          return {
            uid: docSnap.id,
            email: d.email || '',
            displayName: d.displayName || 'Utilisateur',
            role: (d.role as UserRole) || 'collaborator',
            isActive: d.isActive !== false,
            createdAt: d.createdAt || new Date().toISOString(),
            lastLoginAt: d.lastLoginAt,
            phone: d.phone,
          };
        });
        setUsersList(loaded);
        setLoadingUsers(false);
      }, (err) => {
        console.warn('Erreur écoute des utilisateurs:', err);
        setLoadingUsers(false);
      });

      return () => unsubscribe();
    } catch {
      setLoadingUsers(false);
    }
  }, []);

  // Écoute des invitations pour l'ADMIN
  useEffect(() => {
    if (!isAdmin) return;
    const unsub = listenToInvitations((list) => {
      setInvitations(list);
    });
    return () => unsub();
  }, [isAdmin]);

  const handleCreateInvite = async () => {
    if (!isAdmin) return;
    setGeneratingInvite(true);
    setInviteFeedback(null);
    const res = await createInvitation(profile?.uid || 'usr_admin', profile?.displayName || 'ADMIN');
    setGeneratingInvite(false);

    if (res.success && res.code) {
      setInviteFeedback({
        success: true,
        msg: `Nouvelle invitation créée : ${res.code}. Copiez-la et transmettez-la à l'utilisateur.`,
      });
    } else {
      setInviteFeedback({
        success: false,
        msg: res.error || 'Erreur lors de la création de l’invitation.',
      });
    }
  };

  const handleRevokeInvite = async (code: string) => {
    if (!isAdmin) return;
    const res = await revokeInvitation(code, profile?.uid || 'usr_admin', profile?.displayName || 'ADMIN');
    if (res.success) {
      setInviteFeedback({
        success: true,
        msg: `L'invitation ${code} a été révoquée avec succès.`,
      });
    } else {
      setInviteFeedback({
        success: false,
        msg: res.error || 'Erreur lors de la révocation.',
      });
    }
  };

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2500);
  };

  const handleToggleStatus = async (userItem: UserProfile) => {
    if (!isAdmin) return;
    if (userItem.uid === profile?.uid) {
      alert('Vous ne pouvez pas désactiver votre propre compte ADMIN.');
      return;
    }
    await toggleAccountStatus(userItem.uid, userItem.isActive);
  };

  const totalActive = usersList.filter(u => u.isActive).length;
  const isLimitReached = totalActive >= MAX_ACTIVE_ACCOUNTS;

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-6">
      {/* 1. En-tête & Jauge de capacité (Max 6 comptes) */}
      <div className="bg-[#FAF8F5] rounded-3xl border border-[#E2DDD3] p-6 sm:p-7 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#294637]/10 text-[#294637] border border-[#294637]/20 mb-2">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Contrôle d'accès & Équipe (Max 6 personnes)</span>
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-[#1F2421] tracking-tight">
              Gestion de l'Équipe & Accès
            </h2>
            <p className="text-xs sm:text-sm text-[#5A625D] mt-1">
              Les utilisateurs disposent des fonctionnalités opérationnelles de vente et gestion. L’ADMIN pilote les finances et les accès.
            </p>
          </div>

          {isAdmin && (
            <button
              onClick={handleCreateInvite}
              disabled={isLimitReached || generatingInvite}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#294637] hover:bg-[#1E3429] text-[#FAF8F5] font-bold text-xs shadow-xs transition disabled:opacity-50 disabled:pointer-events-none"
            >
              <Ticket className="w-4 h-4" />
              <span>{generatingInvite ? 'Génération...' : 'Créer une invitation'}</span>
            </button>
          )}
        </div>

        {/* Barre de capacité des 6 comptes */}
        <div className="bg-[#F4F1E9] rounded-2xl p-4 border border-[#E2DDD3]">
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="text-[#1F2421] font-semibold flex items-center gap-2">
              <Users className="w-4 h-4 text-[#294637]" />
              Capacité maximale de la boutique
            </span>
            <span className="font-bold text-[#1F2421]">
              <span className={isLimitReached ? 'text-[#B87555]' : 'text-[#294637]'}>
                {totalActive}
              </span>{' '}
              / {MAX_ACTIVE_ACCOUNTS} comptes actifs (ADMIN compris)
            </span>
          </div>

          <div className="w-full h-2.5 rounded-full bg-[#E2DDD3] overflow-hidden">
            <div
              className={`h-full transition-all duration-500 ${
                isLimitReached ? 'bg-[#B87555]' : 'bg-[#294637]'
              }`}
              style={{ width: `${Math.min((totalActive / MAX_ACTIVE_ACCOUNTS) * 100, 100)}%` }}
            />
          </div>

          <div className="mt-2.5 flex flex-wrap items-center justify-between text-[11px] text-[#5A625D] gap-2">
            <span>
              {isLimitReached
                ? '⚠️ Limite de 6 comptes atteinte. Désactivez un compte avant de créer une nouvelle invitation.'
                : `Il reste ${MAX_ACTIVE_ACCOUNTS - totalActive} place(s) disponible(s).`}
            </span>
            <span className="text-[#6A726D]">
              Règle : Inscription uniquement sur invitation de l’ADMIN.
            </span>
          </div>
        </div>
      </div>

      {/* 2. Section des invitations d'inscription (Visible uniquement pour l'ADMIN) */}
      {isAdmin && (
        <div className="bg-[#FAF8F5] rounded-3xl border border-[#E2DDD3] p-6 shadow-xs">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-base font-bold text-[#1F2421] flex items-center gap-2">
              <Ticket className="w-5 h-5 text-[#294637]" />
              Codes d’Invitation ({invitations.length})
            </h3>
            <span className="text-[11px] text-[#5A625D]">
              Usage unique • Révocable à tout moment
            </span>
          </div>
          <p className="text-xs text-[#5A625D] mb-4">
            Pour inscrire un nouvel utilisateur, transmettez-lui l'un des codes actifs ci-dessous.
          </p>

          {inviteFeedback && (
            <div className={`mb-4 p-3 rounded-2xl text-xs flex items-center gap-2 ${
              inviteFeedback.success 
                ? 'bg-emerald-50 border border-emerald-200 text-emerald-800' 
                : 'bg-rose-50 border border-rose-200 text-rose-800'
            }`}>
              {inviteFeedback.success ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> : <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />}
              <span>{inviteFeedback.msg}</span>
            </div>
          )}

          {invitations.length === 0 ? (
            <div className="p-6 rounded-2xl bg-[#F4F1E9] text-center text-xs text-[#5A625D] border border-dashed border-[#E2DDD3]">
              Aucune invitation active. Cliquez sur « Créer une invitation » pour inviter un utilisateur.
            </div>
          ) : (
            <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
              {invitations.map((inv) => {
                const isActive = inv.status === 'active';
                const isUsed = inv.status === 'used';

                return (
                  <div
                    key={inv.id}
                    className={`p-3.5 rounded-2xl border flex items-center justify-between text-xs transition ${
                      isActive 
                        ? 'bg-[#F4F1E9] border-[#E2DDD3]' 
                        : 'bg-[#F4F1E9]/50 border-[#E2DDD3]/60 opacity-60'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="font-mono text-sm font-bold tracking-wider text-[#294637] bg-[#FAF8F5] px-3 py-1.5 rounded-xl border border-[#E2DDD3]">
                        {inv.code}
                      </div>

                      <div>
                        <div className="font-semibold text-[#1F2421] flex items-center gap-2">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            isActive 
                              ? 'bg-emerald-100 text-emerald-800' 
                              : isUsed 
                                ? 'bg-sky-100 text-sky-800' 
                                : 'bg-rose-100 text-rose-800'
                          }`}>
                            {isActive ? 'Actif' : isUsed ? 'Utilisé' : 'Révoqué'}
                          </span>
                          <span className="text-[11px] text-[#6A726D]">
                            Créé le {new Date(inv.createdAt).toLocaleDateString('fr-FR')}
                          </span>
                        </div>

                        {isUsed && inv.usedByEmail && (
                          <p className="text-[10px] text-[#6A726D] mt-0.5">
                            Compte créé par : {inv.usedByEmail}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {isActive && (
                        <>
                          <button
                            onClick={() => handleCopyCode(inv.code)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#FAF8F5] border border-[#E2DDD3] text-[#1F2421] text-[11px] font-semibold hover:bg-[#EFEAE1] transition"
                            title="Copier le code"
                          >
                            {copiedCode === inv.code ? (
                              <>
                                <Check className="w-3.5 h-3.5 text-emerald-600" />
                                <span className="text-emerald-700">Copié</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3.5 h-3.5 text-[#5A625D]" />
                                <span>Copier</span>
                              </>
                            )}
                          </button>

                          <button
                            onClick={() => handleRevokeInvite(inv.code)}
                            className="p-1.5 rounded-lg text-rose-700 hover:bg-rose-50 transition"
                            title="Révoquer cette invitation"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 3. Liste des comptes utilisateurs réels */}
      <div className="bg-[#FAF8F5] rounded-3xl border border-[#E2DDD3] p-6 shadow-xs">
        <h3 className="text-base font-bold text-[#1F2421] mb-1 flex items-center gap-2">
          <Users className="w-5 h-5 text-[#294637]" />
          Comptes de la Boutique ({usersList.length})
        </h3>
        <p className="text-xs text-[#5A625D] mb-5">
          Comptes actifs et historique du personnel de la boutique.
        </p>

        {loadingUsers ? (
          <div className="py-8 text-center text-xs text-[#5A625D]">
            Chargement de l'équipe...
          </div>
        ) : usersList.length === 0 ? (
          <div className="p-6 rounded-2xl bg-[#F4F1E9] border border-[#E2DDD3] text-center">
            <p className="text-xs text-[#1F2421]">
              Aucun compte supplémentaire enregistré.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {usersList.map((userItem) => {
              const uRoleMeta = ROLE_DEFINITIONS[userItem.role] || ROLE_DEFINITIONS.collaborator;
              const isSelf = userItem.uid === profile?.uid;

              return (
                <div
                  key={userItem.uid}
                  className={`p-4 rounded-2xl border transition ${
                    userItem.isActive
                      ? 'bg-[#F4F1E9] border-[#E2DDD3]'
                      : 'bg-[#F4F1E9]/50 border-[#E2DDD3]/50 opacity-60'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-10 h-10 rounded-xl bg-[#294637] text-[#FAF8F5] flex items-center justify-center font-bold text-sm uppercase">
                        {userItem.displayName.charAt(0)}
                      </div>
                      <div className="overflow-hidden">
                        <div className="text-xs font-bold text-[#1F2421] truncate flex items-center gap-1.5">
                          <span>{userItem.displayName}</span>
                          {isSelf && (
                            <span className="text-[9px] px-1.5 py-0.2 rounded bg-[#294637]/15 text-[#294637] font-semibold">
                              Vous
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-[#5A625D] truncate">
                          {userItem.email}
                        </div>
                      </div>
                    </div>

                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${uRoleMeta.badgeBg} ${uRoleMeta.badgeText} ${uRoleMeta.badgeBorder}`}>
                      {uRoleMeta.shortLabel}
                    </span>
                  </div>

                  <div className="space-y-1.5 text-[11px] text-[#5A625D] border-t border-[#E2DDD3] pt-3">
                    <div className="flex items-center justify-between">
                      <span>Statut du compte :</span>
                      <span className={`font-semibold ${userItem.isActive ? 'text-emerald-700' : 'text-[#B87555]'}`}>
                        {userItem.isActive ? 'Actif' : 'Désactivé'}
                      </span>
                    </div>
                    {userItem.phone && (
                      <div className="flex items-center justify-between">
                        <span>Téléphone :</span>
                        <span className="text-[#1F2421] font-mono">{userItem.phone}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <span>Dernière connexion :</span>
                      <span className="text-[#6A726D]">
                        {userItem.lastLoginAt 
                          ? new Date(userItem.lastLoginAt).toLocaleDateString('fr-FR')
                          : 'Non renseigné'}
                      </span>
                    </div>
                  </div>

                  {/* Actions d'administration */}
                  {isAdmin && !isSelf && (
                    <div className="mt-3 pt-3 border-t border-[#E2DDD3] flex items-center justify-end">
                      <button
                        onClick={() => handleToggleStatus(userItem)}
                        className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg transition ${
                          userItem.isActive
                            ? 'text-[#B87555] hover:bg-[#B87555]/10'
                            : 'text-emerald-700 hover:bg-emerald-50'
                        }`}
                      >
                        {userItem.isActive ? 'Désactiver le compte' : 'Réactiver le compte'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
