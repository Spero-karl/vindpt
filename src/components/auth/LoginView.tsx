/**
 * Écran de connexion et d'inscription (Palette Prestige Boutique & Cave)
 * Image de fond : Bouteille de grand vin, verre de vin rouge et rose
 * Formulaire de connexion épuré et création de compte automatique sur invitation
 * Application : GESTION BOISSONS
 */

import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { validateInvitation } from '../../services/invitations';
import { 
  Lock, 
  Mail, 
  AlertCircle, 
  CheckCircle2, 
  Wine,
  Ticket,
  ArrowRight,
  User,
  Sparkles,
  ShieldCheck
} from 'lucide-react';

interface LoginViewProps {
  onOpenSettings?: () => void;
}

export const LoginView: React.FC<LoginViewProps> = () => {
  const { 
    signIn, 
    registerWithInvitation,
    resetPassword, 
    error, 
    clearError 
  } = useAuth();

  // Mode principal : 'login' ou 'invitation'
  const [mode, setMode] = useState<'login' | 'invitation'>('login');
  
  // Login form state pré-rempli avec le compte ADMIN par défaut
  const [loginEmail, setLoginEmail] = useState('FULL-karlfreaton@gmail.com');
  const [loginPassword, setLoginPassword] = useState('FULLADMIN.COM123!');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Invitation form state
  const [inviteCode, setInviteCode] = useState('');
  const [codeVerified, setCodeVerified] = useState(false);
  const [checkingCode, setCheckingCode] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [invitePassword, setInvitePassword] = useState('');
  const [inviteConfirmPassword, setInviteConfirmPassword] = useState('');

  // Password reset modal state
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [resetEmailInput, setResetEmailInput] = useState('');
  const [resetFeedback, setResetFeedback] = useState<{ success: boolean; msg: string } | null>(null);

  // Local form error / feedback
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    clearError();

    if (!loginEmail.trim() || !loginPassword) {
      setFormError('Veuillez renseigner votre email et mot de passe.');
      return;
    }

    setIsSubmitting(true);
    const res = await signIn(loginEmail.trim(), loginPassword);
    setIsSubmitting(false);

    if (!res.success && res.error) {
      setFormError(res.error);
    }
  };

  const handleVerifyCodeOnly = async () => {
    if (!inviteCode.trim()) {
      setFormError('Veuillez saisir votre code d’invitation (ex: INV-XXXXXX).');
      return;
    }

    setCheckingCode(true);
    setFormError(null);
    const result = await validateInvitation(inviteCode.trim());
    setCheckingCode(false);

    if (result.valid) {
      setCodeVerified(true);
      setFormSuccess('Code d’invitation vérifié avec succès ! Complétez vos informations ci-dessous pour créer votre compte.');
    } else {
      setCodeVerified(false);
      setFormError(result.error || 'Code d’invitation invalide, expiré ou révoqué.');
    }
  };

  const handleInvitationSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);
    clearError();

    const cleanCode = inviteCode.trim().toUpperCase();
    const cleanEmail = inviteEmail.trim().toLowerCase();
    const cleanName = inviteName.trim();

    if (!cleanCode) {
      setFormError('Veuillez renseigner le code d’invitation.');
      return;
    }

    if (!cleanName || !cleanEmail || !invitePassword) {
      setFormError('Tous les champs sont obligatoires pour créer votre compte.');
      return;
    }

    if (invitePassword.length < 6) {
      setFormError('Le mot de passe doit comporter au moins 6 caractères.');
      return;
    }

    if (invitePassword !== inviteConfirmPassword) {
      setFormError('Les deux mots de passe ne correspondent pas.');
      return;
    }

    setIsSubmitting(true);
    const res = await registerWithInvitation(
      cleanCode, 
      cleanEmail, 
      invitePassword, 
      cleanName
    );
    setIsSubmitting(false);

    if (!res.success && res.error) {
      setFormError(res.error);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetEmailInput.trim()) return;

    setIsSubmitting(true);
    const res = await resetPassword(resetEmailInput);
    setIsSubmitting(false);

    if (res.success) {
      setResetFeedback({
        success: true,
        msg: `Un email de réinitialisation a été envoyé à ${resetEmailInput}.`,
      });
    } else {
      setResetFeedback({
        success: false,
        msg: res.error || 'Erreur lors de l’envoi de l’email de réinitialisation.',
      });
    }
  };

  return (
    <div className="relative min-h-screen flex flex-col justify-center py-10 px-4 sm:px-6 lg:px-8 text-[#FAF8F5] overflow-hidden">
      {/* Arrière-plan avec photo de prestige (Bouteille, verre de vin & rose rouge) */}
      <div 
        className="fixed inset-0 pointer-events-none z-0 bg-cover bg-center bg-no-repeat scale-100 opacity-65 transition-opacity duration-700"
        style={{ backgroundImage: `url('/background.jpg')` }}
      />
      {/* Voile sombre transparent équilibré */}
      <div className="fixed inset-0 pointer-events-none z-0 bg-gradient-to-b from-black/60 via-black/40 to-black/70" />

      <div className="relative z-10 sm:mx-auto sm:w-full sm:max-w-md">
        {/* Logo & Titre */}
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-16 h-16 rounded-3xl bg-[#294637] border border-amber-500/30 text-[#FAF8F5] flex items-center justify-center shadow-2xl mb-3">
            <Wine className="w-8 h-8 text-amber-200" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white drop-shadow-md">
            GESTION BOISSONS
          </h1>
          <p className="text-xs text-amber-100/90 mt-1 max-w-xs leading-relaxed font-medium">
            Cave & Boutique de boissons de prestige
          </p>
        </div>
      </div>

      <div className="relative z-10 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-[#FAF8F5] py-7 px-6 sm:px-8 shadow-2xl rounded-3xl border border-[#E2DDD3] text-[#1F2421]">
          {/* Navigation d'accès : Connexion ou Créer un compte */}
          <div className="flex rounded-2xl bg-[#F4F1E9] p-1 mb-6 border border-[#E2DDD3] text-xs font-semibold">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setFormError(null);
                setFormSuccess(null);
                clearError();
              }}
              className={`flex-1 py-2.5 text-center rounded-xl transition cursor-pointer ${
                mode === 'login'
                  ? 'bg-[#294637] text-[#FAF8F5] shadow-xs font-bold'
                  : 'text-[#6A726D] hover:text-[#1F2421]'
              }`}
            >
              Se connecter
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('invitation');
                setFormError(null);
                setFormSuccess(null);
                clearError();
              }}
              className={`flex-1 py-2.5 text-center rounded-xl transition cursor-pointer flex items-center justify-center gap-1.5 ${
                mode === 'invitation'
                  ? 'bg-[#294637] text-[#FAF8F5] shadow-xs font-bold'
                  : 'text-[#6A726D] hover:text-[#1F2421]'
              }`}
            >
              <Ticket className="w-3.5 h-3.5" />
              Créer un compte
            </button>
          </div>

          {/* Affichage des retours d'erreurs ou succès */}
          {(formError || error) && (
            <div className="mb-5 p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{formError || error}</span>
            </div>
          )}

          {formSuccess && (
            <div className="mb-5 p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <span>{formSuccess}</span>
            </div>
          )}

          {mode === 'login' ? (
            /* Formulaire strict de connexion par email et mot de passe */
            <form onSubmit={handleLoginSubmit} className="space-y-4 text-xs">
              <div className="p-3 rounded-2xl bg-[#294637]/10 border border-[#294637]/20 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-[#294637]" />
                  <span className="font-bold text-[#294637]">Compte ADMIN officiel</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setLoginEmail('FULL-karlfreaton@gmail.com');
                    setLoginPassword('FULLADMIN.COM123!');
                  }}
                  className="text-[11px] font-semibold text-[#294637] hover:underline cursor-pointer"
                >
                  Rétablir identifiants
                </button>
              </div>

              <div>
                <label className="block font-semibold text-[#1F2421] mb-1.5">
                  Adresse email
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-[#7A847E] absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="email"
                    required
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    placeholder="votre.email@domaine.com"
                    autoComplete="email"
                    className="w-full pl-10 pr-3.5 py-3 bg-[#F4F1E9] border border-[#E2DDD3] rounded-2xl text-[#1F2421] text-xs focus:outline-none focus:ring-2 focus:ring-[#294637] transition"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block font-semibold text-[#1F2421]">
                    Mot de passe
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setResetEmailInput(loginEmail);
                      setShowForgotModal(true);
                    }}
                    className="text-[11px] text-[#B87555] hover:underline cursor-pointer"
                  >
                    Mot de passe oublié ?
                  </button>
                </div>
                <div className="relative">
                  <Lock className="w-4 h-4 text-[#7A847E] absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="password"
                    required
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    className="w-full pl-10 pr-3.5 py-3 bg-[#F4F1E9] border border-[#E2DDD3] rounded-2xl text-[#1F2421] text-xs focus:outline-none focus:ring-2 focus:ring-[#294637] transition"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-3.5 mt-2 rounded-2xl bg-[#294637] hover:bg-[#1E3429] text-[#FAF8F5] text-xs font-bold transition shadow-md disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>{isSubmitting ? 'Connexion en cours...' : 'Se connecter'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>

              {/* Raccourci vers la création de compte sur invitation */}
              <div className="pt-4 mt-2 border-t border-[#E8E4DA] text-center">
                <p className="text-[#6A726D] text-xs">
                  Vous avez reçu un code d'invitation ?
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setMode('invitation');
                    setFormError(null);
                    setFormSuccess(null);
                    clearError();
                  }}
                  className="mt-1.5 text-xs font-bold text-[#294637] hover:text-[#1E3429] hover:underline inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Ticket className="w-3.5 h-3.5 text-amber-600" />
                  Créer mon compte avec mon invitation
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </form>
          ) : (
            /* Inscription sur invitation : Enregistrement automatique dans Cloud Firestore */
            <div className="space-y-4 text-xs">
              <div className="p-3.5 rounded-2xl bg-[#F4F1E9] border border-[#E2DDD3] text-[#5A625D]">
                <p className="font-semibold text-[#1F2421] flex items-center gap-1.5 mb-1">
                  <Sparkles className="w-4 h-4 text-amber-600" />
                  Création de compte sur invitation
                </p>
                <p className="text-[11px] leading-relaxed">
                  Renseignez le code unique transmis par votre administrateur. Votre compte sera automatiquement enregistré dans la base Firestore pour vos futures connexions.
                </p>
              </div>

              <form onSubmit={handleInvitationSubmit} className="space-y-3.5">
                {/* Saisie du code d'invitation */}
                <div>
                  <label className="block font-semibold text-[#1F2421] mb-1.5">
                    Code d’invitation *
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      required
                      value={inviteCode}
                      onChange={(e) => {
                        setInviteCode(e.target.value.toUpperCase());
                        setCodeVerified(false);
                        setFormSuccess(null);
                      }}
                      placeholder="ex: INV-XXXXXX"
                      className="flex-1 px-3.5 py-2.5 bg-[#F4F1E9] border border-[#E2DDD3] rounded-2xl text-[#1F2421] font-mono uppercase tracking-wider font-bold text-xs"
                    />
                    <button
                      type="button"
                      onClick={handleVerifyCodeOnly}
                      disabled={checkingCode || !inviteCode.trim()}
                      className={`px-3.5 py-2.5 rounded-2xl text-xs font-bold transition cursor-pointer flex items-center gap-1 ${
                        codeVerified 
                          ? 'bg-emerald-600 text-white' 
                          : 'bg-[#294637] text-[#FAF8F5] disabled:opacity-50'
                      }`}
                    >
                      {checkingCode ? (
                        'Test...'
                      ) : codeVerified ? (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Vérifié
                        </>
                      ) : (
                        'Vérifier'
                      )}
                    </button>
                  </div>
                </div>

                {/* Coordonnées de l'utilisateur */}
                <div>
                  <label className="block font-semibold text-[#1F2421] mb-1">
                    Nom et Prénom *
                  </label>
                  <div className="relative">
                    <User className="w-4 h-4 text-[#7A847E] absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      required
                      value={inviteName}
                      onChange={(e) => setInviteName(e.target.value)}
                      placeholder="ex: Jean Dupont"
                      className="w-full pl-10 pr-3.5 py-2.5 bg-[#F4F1E9] border border-[#E2DDD3] rounded-2xl text-[#1F2421] text-xs"
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-semibold text-[#1F2421] mb-1">
                    Adresse email de connexion *
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-[#7A847E] absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="email"
                      required
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="jean.dupont@boutique.com"
                      className="w-full pl-10 pr-3.5 py-2.5 bg-[#F4F1E9] border border-[#E2DDD3] rounded-2xl text-[#1F2421] text-xs"
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-semibold text-[#1F2421] mb-1">
                    Mot de passe (6 car. minimum) *
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-[#7A847E] absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="password"
                      required
                      minLength={6}
                      value={invitePassword}
                      onChange={(e) => setInvitePassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full pl-10 pr-3.5 py-2.5 bg-[#F4F1E9] border border-[#E2DDD3] rounded-2xl text-[#1F2421] text-xs"
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-semibold text-[#1F2421] mb-1">
                    Confirmer le mot de passe *
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-[#7A847E] absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="password"
                      required
                      minLength={6}
                      value={inviteConfirmPassword}
                      onChange={(e) => setInviteConfirmPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full pl-10 pr-3.5 py-2.5 bg-[#F4F1E9] border border-[#E2DDD3] rounded-2xl text-[#1F2421] text-xs"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-3.5 mt-2 rounded-2xl bg-[#294637] hover:bg-[#1E3429] text-[#FAF8F5] font-bold text-xs transition disabled:opacity-50 cursor-pointer shadow-md flex items-center justify-center gap-2"
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>
                    {isSubmitting ? 'Création et enregistrement...' : 'Créer mon compte et me connecter'}
                  </span>
                </button>

                {/* Lien pour revenir à la connexion */}
                <div className="pt-3 text-center border-t border-[#E8E4DA]">
                  <p className="text-[#6A726D] text-xs">
                    Vous possédez déjà un compte actif ?
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setMode('login');
                      setFormError(null);
                      setFormSuccess(null);
                      clearError();
                    }}
                    className="mt-1 text-xs font-bold text-[#294637] hover:text-[#1E3429] hover:underline cursor-pointer"
                  >
                    Retourner à la connexion
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>

      {/* Modal Réinitialisation mot de passe */}
      {showForgotModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-3xl bg-[#FAF8F5] border border-[#E2DDD3] p-6 shadow-2xl text-[#1F2421]">
            <h3 className="text-base font-bold text-[#1F2421] mb-1">
              Réinitialiser le mot de passe
            </h3>
            <p className="text-xs text-[#5A625D] mb-4">
              Saisissez votre adresse email pour recevoir les instructions de réinitialisation.
            </p>

            {resetFeedback && (
              <div className={`mb-4 p-3 rounded-2xl text-xs flex items-start gap-2 ${
                resetFeedback.success 
                  ? 'bg-emerald-50 border border-emerald-200 text-emerald-800' 
                  : 'bg-rose-50 border border-rose-200 text-rose-800'
              }`}>
                {resetFeedback.success ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                )}
                <span>{resetFeedback.msg}</span>
              </div>
            )}

            <form onSubmit={handleResetPassword} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold mb-1">Adresse email</label>
                <input
                  type="email"
                  required
                  value={resetEmailInput}
                  onChange={(e) => setResetEmailInput(e.target.value)}
                  placeholder="votre.email@domaine.com"
                  className="w-full px-3.5 py-2.5 bg-[#F4F1E9] border border-[#E2DDD3] rounded-2xl text-[#1F2421]"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowForgotModal(false);
                    setResetFeedback(null);
                  }}
                  className="flex-1 py-2.5 rounded-2xl bg-[#E8E4DA] hover:bg-[#DDD8CD] text-[#1F2421] font-semibold transition cursor-pointer"
                >
                  Fermer
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 py-2.5 rounded-2xl bg-[#294637] hover:bg-[#1E3429] text-[#FAF8F5] font-bold transition disabled:opacity-50 cursor-pointer"
                >
                  {isSubmitting ? 'Envoi...' : 'Envoyer le lien'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
