import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useClerk, useUser } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import { setAuthTokenGetter } from '@workspace/api-client-react';
import { useLocation } from 'wouter';
import type { AuthProviderName } from './provider';
import { signOutOfCompanyApp, supabaseIdentity } from './supabase-client';

export type AuthStatus = 'loading' | 'signed-in' | 'signed-out' | 'misconfigured';
export type AppAuth = {
  provider: AuthProviderName;
  status: AuthStatus;
  userId: string | null;
  displayName: string;
  passwordEnabled: boolean | null;
  signOut: () => Promise<void>;
  openAccount: () => void;
};

const AuthContext = createContext<AppAuth | null>(null);

export function useAppAuth(): AppAuth {
  const value = useContext(AuthContext);
  if (!value) throw new Error('Authentication context is missing.');
  return value;
}

/** Clears and cancels every cached query so no previous user's data remains. */
export function useClearUserState() {
  const client = useQueryClient();
  return () => {
    void client.cancelQueries();
    client.clear();
  };
}

export function ClerkAuthBridge({ children, redirectUrl }: { children: ReactNode; redirectUrl: string }) {
  const clerk = useClerk();
  const { isLoaded, isSignedIn, user } = useUser();
  const value: AppAuth = {
    provider: 'clerk',
    status: !isLoaded ? 'loading' : isSignedIn ? 'signed-in' : 'signed-out',
    userId: user?.id ?? null,
    displayName: user?.fullName || user?.primaryEmailAddress?.emailAddress || 'Signed in',
    passwordEnabled: user ? user.passwordEnabled : null,
    signOut: () => clerk.signOut({ redirectUrl }),
    openAccount: () => clerk.openUserProfile(),
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

type SupabaseState = { status: AuthStatus; userId: string | null; email: string | null };

export function SupabaseAuthBridge({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [, setLocation] = useLocation();
  const [state, setState] = useState<SupabaseState>({ status: 'loading', userId: null, email: null });
  const previousUser = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    let identity: ReturnType<typeof supabaseIdentity>;
    try {
      identity = supabaseIdentity();
    } catch {
      setAuthTokenGetter(null);
      setState({ status: 'misconfigured', userId: null, email: null });
      return;
    }
    let active = true;
    // Any auth event supersedes the initial getSession() read, so a slow initial
    // resolution can never restore a previous user's identity after a switch.
    let eventSeen = false;
    setAuthTokenGetter(async () => {
      const { data } = await identity.auth.getSession();
      return data.session?.access_token ?? null;
    });
    const apply = (session: { user?: { id: string; email?: string | null } } | null) => {
      if (!active) return;
      const userId = session?.user?.id ?? null;
      if (previousUser.current !== undefined && previousUser.current !== userId) {
        void client.cancelQueries();
        client.clear();
      }
      previousUser.current = userId;
      setState({ status: userId ? 'signed-in' : 'signed-out', userId, email: session?.user?.email ?? null });
    };
    identity.auth.getSession().then(({ data }) => { if (!eventSeen) apply(data.session); }, () => { if (!eventSeen) apply(null); });
    const { data: subscription } = identity.auth.onAuthStateChange((_event, session) => { eventSeen = true; apply(session); });
    return () => {
      active = false;
      subscription.subscription.unsubscribe();
      setAuthTokenGetter(null);
    };
  }, [client]);

  const value: AppAuth = {
    provider: 'supabase',
    status: state.status,
    userId: state.userId,
    displayName: state.email || 'Signed in',
    passwordEnabled: state.userId ? true : null,
    signOut: async () => {
      try {
        await signOutOfCompanyApp(() => { void client.cancelQueries(); client.clear(); });
      } finally {
        setLocation('/sign-in');
      }
    },
    openAccount: () => setLocation('/auth/password'),
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
