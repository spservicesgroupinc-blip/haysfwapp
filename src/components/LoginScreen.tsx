import React, { useEffect, useState } from 'react';
import {
  Loader2,
  AlertCircle,
  LogIn,
  Mail,
  Lock,
  ShieldCheck,
  User,
  UserPlus,
  KeyRound,
  ArrowLeft,
} from 'lucide-react';
import { fetchRegistrationInfo, type RegistrationInfo } from '../services/appsScriptService';
import { BrandLogo } from './BrandLogo';

export interface RegisterFormValues {
  name: string;
  email: string;
  password: string;
  inviteCode: string;
}

interface LoginScreenProps {
  /** Resolves on success; throw to display a message. */
  onSubmit: (email: string, password: string) => Promise<void>;
  /** Resolves on success; throw to display a message. */
  onRegister: (values: RegisterFormValues) => Promise<void>;
  isDatabaseConfigured: boolean;
}

const INPUT_CLASS =
  'w-full h-11 rounded-lg border border-slate-300 bg-white pl-10 pr-3 text-[14px] text-slate-900 ' +
  'placeholder:text-slate-400 focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/15 transition';

const LABEL_CLASS = 'block text-[12px] font-medium text-slate-600 mb-1.5';

const ICON_WRAP =
  'absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400';

const PRIMARY_BUTTON =
  'w-full h-11 inline-flex items-center justify-center gap-2 rounded-lg bg-red-600 text-white text-[14px] ' +
  'font-semibold hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm';

const SECONDARY_BUTTON =
  'w-full h-11 inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white ' +
  'text-slate-700 text-[14px] font-semibold hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors';

const ErrorNote: React.FC<{ message: string }> = ({ message }) => (
  <div className="flex items-start gap-2.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5">
    <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
    <p className="text-[12px] leading-relaxed text-rose-800">{message}</p>
  </div>
);

export const LoginScreen: React.FC<LoginScreenProps> = ({
  onSubmit,
  onRegister,
  isDatabaseConfigured,
}) => {
  const [mode, setMode] = useState<'signin' | 'register'>('signin');
  const [registration, setRegistration] = useState<RegistrationInfo | null>(null);

  // Sign-in fields.
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Create-account fields.
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirm, setRegConfirm] = useState('');
  const [inviteCode, setInviteCode] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Ask the backend whether self-service sign-up is available. A failure here
  // is not fatal — sign-up stays visible and sign-in still works.
  useEffect(() => {
    if (!isDatabaseConfigured) return;
    let cancelled = false;
    fetchRegistrationInfo()
      .then((info) => {
        if (!cancelled) setRegistration(info);
      })
      .catch(() => {
        if (!cancelled) setRegistration(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isDatabaseConfigured]);

  // Show "Create account" unless the backend explicitly switches sign-up off.
  const canRegister = isDatabaseConfigured && registration?.enabled !== false;
  const minPasswordLength = registration?.minPasswordLength ?? 8;
  const requiresInviteCode = registration?.requiresInviteCode !== false;

  const switchTo = (next: 'signin' | 'register') => {
    setMode(next);
    setError(null);
    setPassword('');
    setRegPassword('');
    setRegConfirm('');
  };

  const handleSignIn = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSubmitting) return;

    if (!email.trim() || !password) {
      setError('Enter your email address and password.');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      await onSubmit(email.trim(), password);
    } catch (err: any) {
      setError(err?.message || 'Sign-in failed. Please try again.');
      setPassword('');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRegister = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSubmitting) return;

    const cleanEmail = regEmail.trim().toLowerCase();

    if (!regName.trim()) {
      setError('Enter your full name.');
      return;
    }
    if (!cleanEmail || cleanEmail.indexOf('@') === -1) {
      setError('Enter a valid email address.');
      return;
    }

    // Mirror the server-side domain rule so the answer is instant rather than
    // arriving after a round trip.
    const domains = registration?.allowedDomains ?? [];
    if (domains.length > 0) {
      const domain = cleanEmail.slice(cleanEmail.lastIndexOf('@') + 1);
      if (!domains.includes(domain)) {
        setError(`Accounts must use an @${domains.join(' or @')} email address.`);
        return;
      }
    }

    if (regPassword.length < minPasswordLength) {
      setError(`Choose a password of at least ${minPasswordLength} characters.`);
      return;
    }
    if (regPassword !== regConfirm) {
      setError('The two passwords do not match.');
      return;
    }
    if (requiresInviteCode && !inviteCode.trim()) {
      setError('Enter the invite code you were given.');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      await onRegister({
        name: regName.trim(),
        email: cleanEmail,
        password: regPassword,
        inviteCode: inviteCode.trim(),
      });
    } catch (err: any) {
      setError(err?.message || 'Your account could not be created. Please try again.');
      setRegPassword('');
      setRegConfirm('');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isRegistering = mode === 'register';

  return (
    <div className="min-h-dvh bg-slate-50 flex flex-col items-center justify-center px-3 py-6 sm:px-5 sm:py-10">
      <div className="w-full max-w-[400px]">
        {/* Brand */}
        <div className="flex flex-col items-center mb-7">
          <BrandLogo size={38} className="justify-center" />
          <p className="mt-2.5 text-[13px] text-slate-500">Restoration Document Suite</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-6">
          <h2 className="text-[15px] font-semibold text-slate-900">
            {isRegistering ? 'Create account' : 'Sign in'}
          </h2>
          <p className="mt-1 text-[12px] text-slate-500">
            {isRegistering
              ? requiresInviteCode
                ? 'You will need the invite code from your administrator.'
                : 'Fill in your details to get started.'
              : 'Use the account provided by your administrator.'}
          </p>

          {!isDatabaseConfigured && (
            <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
              <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <p className="text-[12px] leading-relaxed text-amber-900">
                The customer database is not connected. Set{' '}
                <code className="font-mono">VITE_APPS_SCRIPT_URL</code>, then restart the dev server.
              </p>
            </div>
          )}

          {isRegistering ? (
            <form onSubmit={handleRegister} className="mt-5 space-y-4" noValidate>
              <div>
                <label htmlFor="register-name" className={LABEL_CLASS}>
                  Full name
                </label>
                <div className="relative">
                  <span className={ICON_WRAP}>
                    <User className="w-4 h-4" />
                  </span>
                  <input
                    id="register-name"
                    type="text"
                    autoComplete="name"
                    autoFocus
                    value={regName}
                    onChange={(event) => setRegName(event.target.value)}
                    placeholder="Your full name"
                    disabled={isSubmitting}
                    className={INPUT_CLASS}
                  />
                </div>
              </div>

              <div>
                <label htmlFor="register-email" className={LABEL_CLASS}>
                  Email address
                </label>
                <div className="relative">
                  <span className={ICON_WRAP}>
                    <Mail className="w-4 h-4" />
                  </span>
                  <input
                    id="register-email"
                    type="email"
                    autoComplete="username"
                    value={regEmail}
                    onChange={(event) => setRegEmail(event.target.value)}
                    placeholder="you@example.com"
                    disabled={isSubmitting}
                    className={INPUT_CLASS}
                  />
                </div>
              </div>

              <div>
                <label htmlFor="register-password" className={LABEL_CLASS}>
                  Password
                </label>
                <div className="relative">
                  <span className={ICON_WRAP}>
                    <Lock className="w-4 h-4" />
                  </span>
                  <input
                    id="register-password"
                    type="password"
                    autoComplete="new-password"
                    value={regPassword}
                    onChange={(event) => setRegPassword(event.target.value)}
                    placeholder={`At least ${minPasswordLength} characters`}
                    disabled={isSubmitting}
                    className={INPUT_CLASS}
                  />
                </div>
              </div>

              <div>
                <label htmlFor="register-confirm" className={LABEL_CLASS}>
                  Confirm password
                </label>
                <div className="relative">
                  <span className={ICON_WRAP}>
                    <Lock className="w-4 h-4" />
                  </span>
                  <input
                    id="register-confirm"
                    type="password"
                    autoComplete="new-password"
                    value={regConfirm}
                    onChange={(event) => setRegConfirm(event.target.value)}
                    placeholder="Repeat your password"
                    disabled={isSubmitting}
                    className={INPUT_CLASS}
                  />
                </div>
              </div>

              {requiresInviteCode && (
                <div>
                  <label htmlFor="register-invite" className={LABEL_CLASS}>
                    Invite code
                  </label>
                  <div className="relative">
                    <span className={ICON_WRAP}>
                      <KeyRound className="w-4 h-4" />
                    </span>
                    <input
                      id="register-invite"
                      type="text"
                      autoComplete="off"
                      value={inviteCode}
                      onChange={(event) => setInviteCode(event.target.value)}
                      placeholder="Provided by your administrator"
                      disabled={isSubmitting}
                      className={INPUT_CLASS}
                    />
                  </div>
                </div>
              )}

              {error && <ErrorNote message={error} />}

              <button
                type="submit"
                disabled={isSubmitting || !isDatabaseConfigured}
                className={PRIMARY_BUTTON}
              >
                {isSubmitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <UserPlus className="w-4 h-4" />
                )}
                {isSubmitting ? 'Creating account…' : 'Create account'}
              </button>

              <button
                type="button"
                onClick={() => switchTo('signin')}
                disabled={isSubmitting}
                className={SECONDARY_BUTTON}
              >
                <ArrowLeft className="w-4 h-4" />
                Back to sign in
              </button>

              {registration?.defaultRole && (
                <p className="text-[11px] text-slate-500 text-center">
                  New accounts get {registration.defaultRole} access. An administrator can change
                  this.
                </p>
              )}
            </form>
          ) : (
            <form onSubmit={handleSignIn} className="mt-5 space-y-4" noValidate>
              <div>
                <label htmlFor="login-email" className={LABEL_CLASS}>
                  Email address
                </label>
                <div className="relative">
                  <span className={ICON_WRAP}>
                    <Mail className="w-4 h-4" />
                  </span>
                  <input
                    id="login-email"
                    type="email"
                    autoComplete="username"
                    autoFocus
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@example.com"
                    disabled={isSubmitting}
                    className={INPUT_CLASS}
                  />
                </div>
              </div>

              <div>
                <label htmlFor="login-password" className={LABEL_CLASS}>
                  Password
                </label>
                <div className="relative">
                  <span className={ICON_WRAP}>
                    <Lock className="w-4 h-4" />
                  </span>
                  <input
                    id="login-password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Your password"
                    disabled={isSubmitting}
                    className={INPUT_CLASS}
                  />
                </div>
              </div>

              {error && <ErrorNote message={error} />}

              <button
                type="submit"
                disabled={isSubmitting || !isDatabaseConfigured}
                className={PRIMARY_BUTTON}
              >
                {isSubmitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <LogIn className="w-4 h-4" />
                )}
                {isSubmitting ? 'Signing in…' : 'Sign in'}
              </button>

              {canRegister && (
                <>
                  <div className="relative pt-1">
                    <div className="absolute inset-0 flex items-center" aria-hidden="true">
                      <div className="w-full border-t border-slate-200" />
                    </div>
                    <div className="relative flex justify-center">
                      <span className="bg-white px-2 text-[11px] text-slate-400">New here?</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => switchTo('register')}
                    disabled={isSubmitting}
                    className={SECONDARY_BUTTON}
                  >
                    <UserPlus className="w-4 h-4" />
                    Create account
                  </button>
                </>
              )}
            </form>
          )}
        </div>

        <p className="mt-5 flex items-center justify-center gap-1.5 text-[11px] text-slate-500">
          <ShieldCheck className="w-3.5 h-3.5 text-slate-400" />
          Accounts lock temporarily after repeated failed attempts.
        </p>

        <p className="mt-2 text-center text-[11px] text-slate-400">
          Hays &amp; Sons Complete Restoration — Fort Wayne Division
        </p>
      </div>
    </div>
  );
};
