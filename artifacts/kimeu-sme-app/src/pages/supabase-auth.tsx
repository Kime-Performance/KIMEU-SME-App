import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowRight, CircleAlert, LockKeyhole, ShieldCheck } from 'lucide-react';
import { Link, Redirect, useLocation } from 'wouter';
import { getGetSupabaseSessionQueryKey, useGetSupabaseSession, useRequestSupabaseRecovery } from '@workspace/api-client-react';
import { useAppAuth, useClearUserState } from '@/auth/auth-context';
import { preparePasswordCallback } from '@/auth/auth-callback';
import { signInWithCompanyPassword, supabaseIdentity } from '@/auth/supabase-client';
import { isAuthRejection } from '@/auth/provider';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

function Mark() {
  return <img className="brand-wordmark" src={`${basePath}/brand/kimeu-wordmark.png`} alt="KIMEU" />;
}

export function AuthFrame({ kicker, title, detail, children }: { kicker: string; title: string; detail: string; children?: ReactNode }) {
  return <div className="auth-wall">
    <div className="auth-intro"><Mark /><span>{kicker}</span><h1>{title}</h1><p>{detail}</p></div>
    {children && <div className="sb-auth-card">{children}</div>}
  </div>;
}

function FormError({ message }: { message: string }) {
  if (!message) return null;
  return <div className="sb-auth-alert" role="alert" data-testid="status-auth-error"><CircleAlert size={16} /><span>{message}</span></div>;
}

export function SupabaseSignInPage() {
  const auth = useAppAuth();
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (auth.status === 'signed-in') return <Redirect to="/today" />;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await signInWithCompanyPassword(email, password);
      setPassword('');
      setLocation('/today');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sign-in could not be completed.');
    } finally {
      setBusy(false);
    }
  }
  return <AuthFrame kicker="PRIVATE KIMEU WORKSPACE" title="Good work starts with a clear record." detail="Sign in with your approved work email. Access is limited to KIMEU SMEs, Regional Directors, Fellowship reviewers, physical therapists on the roster, and administrators.">
    <h2 className="sb-auth-title">Welcome back</h2>
    <p className="sb-auth-sub">Sign in to access KIMEU operations</p>
    {auth.status === 'misconfigured' ? <FormError message="Sign-in is not configured for this environment. Contact the KIMEU administrator." /> : <form className="sb-auth-form" onSubmit={submit}>
      <label>Work email<input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={254} data-testid="input-sign-in-email" /></label>
      <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required data-testid="input-sign-in-password" /></label>
      <FormError message={error} />
      <button type="submit" className="sb-auth-button" disabled={busy || auth.status === 'loading'} data-testid="button-sign-in">{busy ? 'Signing in' : 'Continue'}<ArrowRight size={16} /></button>
    </form>}
    <div className="sb-auth-foot"><Link href="/auth/recovery-request" data-testid="link-forgot-password">Forgot your password?</Link></div>
  </AuthFrame>;
}

export function SupabaseRecoveryRequestPage() {
  const request = useRequestSupabaseRecovery();
  const [email, setEmail] = useState('');
  const [sentMessage, setSentMessage] = useState('');
  const [error, setError] = useState('');
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    request.mutate({ data: { email: email.trim() } }, {
      // Same acknowledgement for every address. The server decides delivery.
      onSuccess: (ack) => setSentMessage(ack.message || 'If this address belongs to an approved KIMEU account, a reset link will arrive shortly.'),
      onError: () => setError('The request could not be sent. Check your connection and try again.'),
    });
  }
  return <AuthFrame kicker="ACCOUNT RECOVERY" title="Reset your password." detail="Enter your work email. If it belongs to an approved KIMEU account, we will send a single-use reset link.">
    <h2 className="sb-auth-title">Request a reset link</h2>
    {sentMessage ? <div className="sb-auth-ok" role="status" data-testid="status-recovery-sent"><ShieldCheck size={16} /><span>{sentMessage}</span></div> : <form className="sb-auth-form" onSubmit={submit}>
      <label>Work email<input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={254} data-testid="input-recovery-email" /></label>
      <FormError message={error} />
      <button type="submit" className="sb-auth-button" disabled={request.isPending} data-testid="button-request-recovery">{request.isPending ? 'Sending' : 'Send reset link'}<ArrowRight size={16} /></button>
    </form>}
    <div className="sb-auth-foot"><Link href="/sign-in" data-testid="link-back-sign-in">Return to sign in</Link></div>
  </AuthFrame>;
}

type CallbackState = { phase: 'verifying' } | { phase: 'invalid'; message: string } | { phase: 'ready'; setPassword: (password: string) => Promise<void> } | { phase: 'done' };

export function SupabaseCallbackPage({ kind }: { kind: 'invite' | 'recovery' }) {
  const clearUserState = useClearUserState();
  const clearRef = useRef(clearUserState);
  clearRef.current = clearUserState;
  const started = useRef(false);
  const [state, setState] = useState<CallbackState>({ phase: 'verifying' });
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    preparePasswordCallback(window.location.href, {
      clearUrl: () => window.history.replaceState(null, '', window.location.pathname),
      clearUserState: () => clearRef.current(),
    }).then(
      (setter) => setState({ phase: 'ready', setPassword: setter }),
      (cause) => setState({ phase: 'invalid', message: cause instanceof Error ? cause.message : 'This account link is invalid. Request a new link.' }),
    );
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.phase !== 'ready') return;
    if (password !== confirm) { setError('The two passwords do not match.'); return; }
    setBusy(true);
    setError('');
    try {
      await state.setPassword(password);
      setPassword(''); setConfirm('');
      setState({ phase: 'done' });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The password could not be saved.');
    } finally {
      setBusy(false);
    }
  }
  const invite = kind === 'invite';
  return <AuthFrame kicker={invite ? 'ACCOUNT SETUP' : 'ACCOUNT RECOVERY'} title={invite ? 'Set your password.' : 'Choose a new password.'} detail="This link works once and expires. Workspace access is still confirmed against the KIMEU roster after you sign in.">
    {state.phase === 'verifying' && <div className="sb-auth-status" role="status" data-testid="status-callback-verifying"><span className="skeleton-dot" /> Checking your link</div>}
    {state.phase === 'invalid' && <>
      <h2 className="sb-auth-title">Link unavailable</h2>
      <FormError message={state.message} />
      <div className="sb-auth-actions"><Link href="/auth/recovery-request" className="sb-auth-button" data-testid="link-request-new-link">Request a new link<ArrowRight size={16} /></Link><Link href="/sign-in" className="sb-auth-quiet" data-testid="link-callback-sign-in">Return to sign in</Link></div>
    </>}
    {state.phase === 'ready' && <form className="sb-auth-form" onSubmit={submit}>
      <h2 className="sb-auth-title">New password</h2>
      <label>Password<input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required data-testid="input-new-password" /></label>
      <label>Confirm password<input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required data-testid="input-confirm-password" /></label>
      <FormError message={error} />
      <button type="submit" className="sb-auth-button" disabled={busy} data-testid="button-save-password">{busy ? 'Saving' : 'Save password'}<LockKeyhole size={15} /></button>
    </form>}
    {state.phase === 'done' && <>
      <div className="sb-auth-ok" role="status" data-testid="status-password-saved"><ShieldCheck size={16} /><span>Password saved.</span></div>
      <div className="sb-auth-actions"><Link href="/today" className="sb-auth-button" data-testid="link-continue-workspace">Continue to KIMEU<ArrowRight size={16} /></Link></div>
    </>}
  </AuthFrame>;
}

/** Provider-verified password change: re-checks the current password first. */
export function SupabasePasswordPage() {
  const auth = useAppAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (next !== confirm) { setError('The two new passwords do not match.'); return; }
    setBusy(true); setError('');
    try {
      const identity = supabaseIdentity();
      const { data: userData, error: userError } = await identity.auth.getUser();
      const email = userData.user?.email;
      if (userError || !email || userData.user?.id !== auth.userId) throw new Error('Your sign-in changed. Sign in again.');
      const check = await identity.auth.signInWithPassword({ email, password: current });
      if (check.error || check.data.user?.id !== auth.userId) throw new Error('The current password is incorrect.');
      const update = await identity.auth.updateUser({ password: next });
      if (update.error) throw new Error('The password could not be saved. Check password requirements and try again.');
      setCurrent(''); setNext(''); setConfirm(''); setDone(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The password could not be changed.');
    } finally {
      setBusy(false);
    }
  }
  return <div className="animate-rise">
    <Link href="/settings" className="back-link" data-testid="link-back-settings">Back to settings</Link>
    <div className="page-heading"><div><div className="eyebrow">ACCOUNT SECURITY</div><h1>Change password</h1><p>Your current password is verified with the sign-in provider before anything changes.</p></div></div>
    <section className="settings-card sb-password-card">
      {done ? <div className="sb-auth-ok" role="status" data-testid="status-password-changed"><ShieldCheck size={16} /><span>Password changed.</span></div> : <form className="note-form" onSubmit={submit}>
        <label>Current password<input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required data-testid="input-current-password" /></label>
        <div className="form-two">
          <label>New password<input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required data-testid="input-change-new-password" /></label>
          <label>Confirm new password<input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required data-testid="input-change-confirm-password" /></label>
        </div>
        <FormError message={error} />
        <button type="submit" className="button-primary button-small" disabled={busy} data-testid="button-change-password">{busy ? 'Saving' : 'Change password'}<LockKeyhole size={15} /></button>
      </form>}
      <p className="sb-password-alt">Forgot it? <Link href="/auth/recovery-request" data-testid="link-password-recovery">Request a reset link</Link>.</p>
    </section>
  </div>;
}

/**
 * Supabase-mode route gate: requires a provider session AND a server-verified
 * roster identity. Explicit 401/403 closes the workspace; transient errors keep
 * the last verified identity.
 */
export function SupabaseGate({ children }: { children: ReactNode }) {
  const auth = useAppAuth();
  const enabled = auth.status === 'signed-in';
  const session = useGetSupabaseSession({ query: { enabled, queryKey: getGetSupabaseSessionQueryKey(), retry: (count, err) => !isAuthRejection(err) && count < 1, refetchInterval: 60_000, refetchIntervalInBackground: false, refetchOnWindowFocus: true, refetchOnReconnect: true } });
  if (auth.status === 'misconfigured') return <AuthFrame kicker="PRIVATE KIMEU WORKSPACE" title="Sign-in unavailable." detail="Sign-in is not configured for this environment. The workspace stays locked." />;
  if (auth.status === 'loading') return <main className="auth-wall" role="status"><p>Checking your KIMEU access</p></main>;
  if (auth.status === 'signed-out') return <Redirect to="/sign-in" />;
  const errorCode = (session.error as { data?: { code?: unknown } } | null)?.data?.code;
  if (session.isError && errorCode === 'ACCOUNT_PENDING') return <AuthFrame kicker="ACCOUNT SETUP PENDING" title="Your account is almost ready." detail="Your sign-in works, but it has not yet been linked to the KIMEU roster. Linking happens automatically during the nightly roster sync. Check back later, or contact the KIMEU Director.">
    <div className="sb-auth-actions"><button type="button" className="sb-auth-quiet" onClick={() => session.refetch()} data-testid="button-recheck-pending">Check again</button><button type="button" className="sb-auth-button" onClick={() => void auth.signOut()} data-testid="button-account-pending-sign-out">Sign out</button></div>
  </AuthFrame>;
  if (session.isError && isAuthRejection(session.error)) return <AuthFrame kicker="PRIVATE KIMEU WORKSPACE" title="Approved access required." detail="Your sign-in was not accepted for this workspace. Contact the KIMEU Director about your access.">
    <button type="button" className="sb-auth-button" onClick={() => void auth.signOut()} data-testid="button-rejected-sign-out">Sign out</button>
  </AuthFrame>;
  if (!session.data) {
    if (session.isError) return <AuthFrame kicker="PRIVATE KIMEU WORKSPACE" title="Access could not be verified." detail="The workspace stays locked until your access is confirmed.">
      <button type="button" className="sb-auth-button" onClick={() => session.refetch()} data-testid="button-retry-session">Try again</button>
    </AuthFrame>;
    return <main className="auth-wall" role="status"><p>Checking your KIMEU access</p></main>;
  }
  // Staff may use role-gated surfaces from their siteRole ceiling alone; only PT needs a roster person.
  if (session.data.siteRole === 'PT' && !session.data.personId) return <AuthFrame kicker="ACCOUNT SETUP PENDING" title="Your account is almost ready." detail="Your sign-in works, but it has not yet been linked to the KIMEU roster. Linking happens automatically during the nightly roster sync. Check back later, or contact the KIMEU Director.">
    <div className="sb-auth-actions"><button type="button" className="sb-auth-quiet" onClick={() => session.refetch()} data-testid="button-recheck-setup">Check again</button><button type="button" className="sb-auth-button" onClick={() => void auth.signOut()} data-testid="button-pending-sign-out">Sign out</button></div>
  </AuthFrame>;
  return <>{children}</>;
}
