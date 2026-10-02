// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type {
  AuthSessionResponse,
  MeResponse,
  MesLocale
} from "@carbon/mes-core";
import {
  authCodeResponse,
  authSessionResponse,
  meResponse
} from "@carbon/mes-core";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { type ApiClient, createApiClient } from "~/lib/api/client";
import { ApiClientError } from "~/lib/api/errors";
import { useInstances } from "~/lib/instances/InstanceProvider";
import { clearSession, loadSession, saveSession } from "./session";

/**
 * Sign-in runs entirely through the MES server, never straight to Supabase
 * Auth: the IP rate limit, the per-account lockout, the SSO-required refusal
 * and the user-exists check all live in the server's login gates, and a client
 * calling `signInWithOtp` itself would skip all four.
 */
export type AuthState =
  | "loading"
  | "no_instance"
  | "signed_out"
  /** A code was emailed; the app is on the verify screen. */
  | "code_sent"
  /** This account signs in with a password (store review only). */
  | "needs_password"
  /** Tokens are aal1 and the user has a TOTP factor. */
  | "mfa_required"
  | "ready";

type AuthContextValue = {
  state: AuthState;
  api: ApiClient;
  me: MeResponse | null;
  email: string | null;
  /** Shown on every sign-in screen so a bad QR cannot hide the host. */
  serverUrl: string | null;
  insecure: boolean;
  requestCode: (email: string) => Promise<void>;
  verifyCode: (code: string) => Promise<void>;
  verifyMfa: (code: string) => Promise<void>;
  signInWithPassword: (password: string) => Promise<void>;
  reloadMe: () => Promise<void>;
  signOut: () => Promise<void>;
  companyId: string | null;
  setCompanyId: (companyId: string) => void;
  locationId: string | null;
  setLocationId: (locationId: string) => void;
  operatorToken: string | null;
  setOperatorToken: (token: string | null) => void;
  locale: MesLocale | null;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { current, update, loading: instancesLoading } = useInstances();
  const [state, setState] = useState<AuthState>("loading");
  const [me, setMe] = useState<MeResponse | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [locationId, setLocationId] = useState<string | null>(null);

  // Tokens live in refs as well as storage: the API client reads them
  // synchronously on every request, and a stale closure would send the previous
  // instance's token after a switch.
  const accessToken = useRef<string | null>(null);
  const refreshToken = useRef<string | null>(null);
  /** The pinned operator's token NEVER leaves memory (spec, shared tablets). */
  const operatorToken = useRef<string | null>(null);
  const [operatorTokenState, setOperatorTokenState] = useState<string | null>(
    null
  );

  const instanceId = current?.id ?? null;
  const serverUrl = current?.serverUrl ?? null;

  const api = useMemo(
    () =>
      createApiClient({
        scope: () => ({
          serverUrl: serverUrl ?? "",
          companyId: companyId ?? undefined,
          locationId: locationId ?? undefined,
          operatorToken: operatorToken.current ?? undefined
        }),
        getAccessToken: () => accessToken.current,
        refreshSession: async () => null,
        onOperatorToken: (token) => {
          operatorToken.current = token;
          setOperatorTokenState(token);
        }
      }),
    [serverUrl, companyId, locationId]
  );

  const applySession = useCallback(
    async (session: AuthSessionResponse) => {
      accessToken.current = session.accessToken;
      refreshToken.current = session.refreshToken;
      if (instanceId) await saveSession(instanceId, session);
    },
    [instanceId]
  );

  const loadMe = useCallback(async () => {
    const result = await api.request("/me", { schema: meResponse });
    setMe(result);
    setCompanyId((prev) => prev ?? result.companies[0]?.id ?? null);
    setLocationId(
      (prev) =>
        prev ?? result.defaultLocationId ?? result.locations[0]?.id ?? null
    );
    if (current) {
      await update({ ...current, details: result.instance });
    }
    setState("ready");
  }, [api, current, update]);

  // Restore a stored session when the instance changes.
  //
  // `loadMe` is deliberately not a dependency: it closes over `api`, which is
  // rebuilt whenever the company or location changes, so including it would
  // re-fetch /me on every picker change. This effect only restores a stored
  // session when the INSTANCE changes.
  //
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    if (instancesLoading) return;
    let cancelled = false;

    (async () => {
      if (!instanceId) {
        accessToken.current = null;
        refreshToken.current = null;
        setMe(null);
        setState("no_instance");
        return;
      }

      const stored = await loadSession(instanceId);
      if (cancelled) return;
      if (!stored) {
        accessToken.current = null;
        refreshToken.current = null;
        setMe(null);
        setState("signed_out");
        return;
      }

      accessToken.current = stored.accessToken;
      refreshToken.current = stored.refreshToken;
      try {
        await loadMe();
      } catch {
        if (!cancelled) setState("signed_out");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [instanceId, instancesLoading]);

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      api,
      me,
      email,
      serverUrl,
      insecure: current?.scheme === "http",
      companyId,
      setCompanyId,
      locationId,
      setLocationId,
      operatorToken: operatorTokenState,
      setOperatorToken: (token) => {
        operatorToken.current = token;
        setOperatorTokenState(token);
      },
      locale: null,

      async requestCode(nextEmail) {
        const result = await api.request("/auth/code", {
          method: "POST",
          body: { email: nextEmail },
          schema: authCodeResponse,
          isPublic: true
        });
        setEmail(nextEmail);
        setState(result.method === "password" ? "needs_password" : "code_sent");
      },

      async verifyCode(code) {
        if (!email)
          throw new ApiClientError(
            400,
            "validation_failed",
            "Enter your email first"
          );
        const session = await api.request("/auth/verify", {
          method: "POST",
          body: { email, code },
          schema: authSessionResponse,
          isPublic: true
        });
        await applySession(session);
        if (session.mfaRequired) {
          setState("mfa_required");
          return;
        }
        await loadMe();
      },

      async verifyMfa(code) {
        const session = await api.request("/auth/mfa", {
          method: "POST",
          body: {
            accessToken: accessToken.current,
            refreshToken: refreshToken.current,
            code
          },
          schema: authSessionResponse,
          isPublic: true
        });
        await applySession(session);
        await loadMe();
      },

      async signInWithPassword(password) {
        if (!email)
          throw new ApiClientError(
            400,
            "validation_failed",
            "Enter your email first"
          );
        const session = await api.request("/auth/password", {
          method: "POST",
          body: { email, password },
          schema: authSessionResponse,
          isPublic: true
        });
        await applySession(session);
        if (session.mfaRequired) {
          setState("mfa_required");
          return;
        }
        await loadMe();
      },

      reloadMe: loadMe,

      async signOut() {
        if (instanceId) await clearSession(instanceId);
        accessToken.current = null;
        refreshToken.current = null;
        operatorToken.current = null;
        setOperatorTokenState(null);
        setMe(null);
        setCompanyId(null);
        setLocationId(null);
        setState(instanceId ? "signed_out" : "no_instance");
      }
    }),
    [
      state,
      api,
      me,
      email,
      serverUrl,
      current?.scheme,
      companyId,
      locationId,
      operatorTokenState,
      applySession,
      loadMe,
      instanceId
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside an AuthProvider");
  return value;
}
