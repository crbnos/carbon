// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type {
  AuthSessionResponse,
  ConsoleOperator,
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
import { getSupabase } from "./supabase";

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
  /**
   * The linked instance's LOCAL id — the uuid `addInstance` generated, not
   * `me.instance.name`.
   *
   * Every piece of per-instance state keys off this: the stored session, the
   * supabase client's own session store, every query key, the outbox. It has to
   * be the local uuid because `me.instance.name` is a server-chosen DISPLAY
   * name and is not unique — two linked Carbons may both answer "Carbon", and
   * then a cache keyed by it would serve one server's rows for the other. That
   * is the same hazard `keys.ts` keys by company for, one level up.
   */
  instanceId: string | null;
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
  /**
   * Who is pinned in, when anyone is. Memory only, like the token itself: a
   * cold start on a shared tablet must land on the PIN screen, not resume
   * yesterday's operator.
   */
  operator: ConsoleOperator | null;
  setOperator: (operator: ConsoleOperator | null) => void;
  /**
   * The signed terminal token, present once this tablet has been made a shared
   * terminal. Sent only to `POST /console/pin-in`.
   */
  terminalToken: string | null;
  setTerminalToken: (token: string | null) => void;
  setOperatorToken: (token: string | null) => void;
  locale: MesLocale | null;
  /**
   * The current access token, read at call time.
   *
   * A GETTER rather than a value because the token lives in a ref and is
   * rotated by `applySession`; exposing it as state would re-render every
   * consumer on every refresh. The one caller is an authenticated IMAGE url —
   * the inspection drawing, which `expo-image` fetches itself and so cannot go
   * through `api.request`. Everything else must use `api`, which attaches this
   * along with the company, location and operator headers.
   */
  getAccessToken: () => string | null;
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
  const terminalToken = useRef<string | null>(null);
  const [terminalTokenState, setTerminalTokenState] = useState<string | null>(
    null
  );
  const [operator, setOperatorState] = useState<ConsoleOperator | null>(null);
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
          operatorToken: operatorToken.current ?? undefined,
          terminalToken: terminalToken.current ?? undefined
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

  // Hand the session to supabase-js.
  //
  // The direct PostgREST reads — scrap reasons, a scanned tracked entity, an
  // item by readable id — go through this client under RLS as the signed-in
  // user. Without a session it is ANONYMOUS, and an anonymous read of an
  // RLS-gated table returns zero rows rather than an error: the scrap sheet
  // would show an empty reason list and a scanned label would read as "nothing
  // matches". A silent empty result is the worst shape that failure could take,
  // so this is the one place the handoff happens.
  //
  // It keys on `me` because `me` is the state that is set immediately after the
  // tokens are, on every path that produces them (restore, code verify, MFA,
  // password) — the tokens themselves are refs an effect cannot observe.
  //
  // Note that this client carries `autoRefreshToken`, so from here it maintains
  // its OWN copy of the session. That is deliberate: the API client does not
  // refresh (`refreshSession` returns null), so letting supabase-js keep its
  // socket and reads alive is strictly better than both copies expiring.
  useEffect(() => {
    if (!me || !instanceId) return;
    const access_token = accessToken.current;
    const refresh_token = refreshToken.current;
    if (!access_token || !refresh_token) return;

    getSupabase(instanceId, me.instance)
      .auth.setSession({ access_token, refresh_token })
      .catch(() => {
        // A rejected handoff leaves the client anonymous, which the reads that
        // use it already treat as "nothing found". Nothing here can recover it,
        // and throwing would take down a screen that is otherwise working.
      });
  }, [me, instanceId]);

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      api,
      instanceId,
      me,
      email,
      serverUrl,
      insecure: current?.scheme === "http",
      companyId,
      setCompanyId,
      locationId,
      setLocationId,
      operatorToken: operatorTokenState,
      operator,
      setOperator: setOperatorState,
      terminalToken: terminalTokenState,
      setTerminalToken(token) {
        terminalToken.current = token;
        setTerminalTokenState(token);
        // Leaving terminal mode must take the operator with it, or the app
        // would keep sending an operator header it can no longer re-mint.
        if (!token) {
          operatorToken.current = null;
          setOperatorTokenState(null);
          setOperatorState(null);
        }
      },
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
        if (instanceId) {
          await clearSession(instanceId);
          // `scope: "local"` on purpose: this clears the client's stored
          // session without asking the server to revoke the token, which the
          // app's own /api/v1 session lifecycle owns.
          if (me) {
            await getSupabase(instanceId, me.instance)
              .auth.signOut({ scope: "local" })
              .catch(() => {
                // The app's own session is already cleared above, which is
                // what gates every screen. A client that failed to forget its
                // copy must not keep the operator signed in on screen.
              });
          }
        }
        accessToken.current = null;
        refreshToken.current = null;
        operatorToken.current = null;
        setOperatorTokenState(null);
        terminalToken.current = null;
        setTerminalTokenState(null);
        setOperatorState(null);
        setMe(null);
        setCompanyId(null);
        setLocationId(null);
        setState(instanceId ? "signed_out" : "no_instance");
      },
      // Not in the dependency list: it reads a ref, so its identity never has
      // to change for it to return the current token.
      getAccessToken: () => accessToken.current
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
      terminalTokenState,
      operator,
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
