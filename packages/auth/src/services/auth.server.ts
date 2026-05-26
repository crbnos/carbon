import type { Database } from "@carbon/database";
import { checkApiKeyRateLimit } from "@carbon/database/ratelimit";
import { Edition, Plan } from "@carbon/utils";
import type {
  AuthSession as SupabaseAuthSession,
  SupabaseClient
} from "@supabase/supabase-js";
import { createHash } from "crypto";
import { redirect } from "react-router";
import {
  CarbonEdition,
  REFRESH_ACCESS_TOKEN_THRESHOLD,
  STRIPE_BYPASS_COMPANY_IDS,
  VERCEL_URL
} from "../config/env";
import { getCarbon } from "../lib/supabase";
import { getCarbonAPIKeyClient } from "../lib/supabase/client";
import { getCarbonServiceRole } from "../lib/supabase/client.server";
import type { AuthSession } from "../types";
import { path } from "../utils/path";
import { error } from "../utils/result";
import {
  AuthClientScope,
  AuthContextHolder,
  getAuthClient,
  type ResolvedApiKeyRecord
} from "./auth-context.server";
import {
  destroyAuthSession,
  flash,
  requireAuthSession as requireAuthSessionOriginal
} from "./session.server";

// Per-request cache for requireAuthSession: it is called twice per request
// (once in resolveAuthContext / middleware, once in requirePermissions) and
// each call re-reads the cookie, re-decodes it, and may re-refresh the token.
// WeakMap<Request, AuthSession> means the entry lives exactly as long as the
// request object — no manual cleanup needed.
const authSessionCache = new WeakMap<
  Request,
  Awaited<ReturnType<typeof requireAuthSessionOriginal>>
>();

async function requireAuthSession(request: Request) {
  const cached = authSessionCache.get(request);
  if (cached) return cached;
  const session = await requireAuthSessionOriginal(request);
  authSessionCache.set(request, session);
  return session;
}

import { getCompaniesForUser } from "./users";
import { getUserClaims } from "./users.server";

export async function createEmailAuthAccount(
  email: string,
  password: string,
  meta?: Record<string, unknown>
) {
  const { data, error } = await getCarbonServiceRole().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: {
      ...meta
    }
  });

  if (!data.user || error) return null;

  return data.user;
}

export async function deleteAuthAccount(
  client: SupabaseClient<Database>,
  userId: string
) {
  const [supabaseDelete, carbonDelete] = await Promise.all([
    client.auth.admin.deleteUser(userId),
    client.from("user").delete().eq("id", userId)
  ]);

  if (supabaseDelete.error || carbonDelete.error) return null;

  return true;
}

export async function getAuthAccountByAccessToken(accessToken: string) {
  const { data, error } =
    await getCarbonServiceRole().auth.getUser(accessToken);

  if (!data.user || error) return null;

  return data.user;
}

/** Hash an API key using SHA-256 for secure storage/lookup */
export function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

function getCompanyIdFromAPIKey(apiKey: string) {
  const serviceRole = getCarbonServiceRole();
  const keyHash = hashApiKey(apiKey);
  return serviceRole
    .from("apiKey")
    .select(
      "id, companyId, ...company(companyGroupId), createdBy, scopes, rateLimit, rateLimitWindow, expiresAt"
    )
    .eq("keyHash", keyHash)
    .single();
}

function makeAuthSession(
  supabaseSession: SupabaseAuthSession | null,
  companyId: string,
  companyGroupId: string
): AuthSession | null {
  if (!supabaseSession) return null;

  if (!supabaseSession.refresh_token)
    throw new Error("User should have a refresh token");

  if (!supabaseSession.user?.email)
    throw new Error("User should have an email");

  return {
    accessToken: supabaseSession.access_token,
    companyId,
    companyGroupId,
    refreshToken: supabaseSession.refresh_token,
    userId: supabaseSession.user.id,
    email: supabaseSession.user.email,
    expiresIn:
      (supabaseSession.expires_in ?? 3000) - REFRESH_ACCESS_TOKEN_THRESHOLD,
    expiresAt: supabaseSession.expires_at ?? -1
  };
}

/**
 * Determines the effective user based on console mode and pin-in state.
 * If console mode is on and an operator is pinned in, returns
 * the operator's ID. Otherwise returns the session user's ID.
 *
 * Console mode is read from the auth session; pin-in state is
 * still read from the `console-pin-{companyId}` cookie.
 */
function getEffectiveUser(
  request: Request,
  companyId: string,
  sessionUserId: string,
  consoleMode: boolean
): string {
  if (!consoleMode) return sessionUserId;

  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return sessionUserId;

  // Parse only the pin-in cookie we need
  const cookies = Object.fromEntries(
    cookieHeader.split(";").map((c) => {
      const [key, ...rest] = c.trim().split("=");
      return [key, decodeURIComponent(rest.join("="))];
    })
  );

  const pinRaw = cookies[`console-pin-${companyId}`];
  if (!pinRaw) return sessionUserId;

  try {
    const pinIn = JSON.parse(pinRaw);
    const elapsed = Date.now() - pinIn.pinnedAt;
    if (elapsed > 3600000) return sessionUserId;
    return pinIn.userId ?? sessionUserId;
  } catch {
    return sessionUserId;
  }
}

// Identity-only resolution, extracted verbatim from requirePermissions so
// the two CANNOT diverge (the console-mode landmine: getEffectiveUser must
// be applied identically, or shop-floor pin-in work is mis-attributed).
//
// Called ONCE per request by `authContextMiddleware` to establish the
// `AuthContextHolder` scope. It does NOT build the RLS client and does
// NOT enforce route permissions — those stay in `requirePermissions`
// because they depend on the route's `requiredPermissions` (e.g.
// `bypassRls`). Returns `null` for unauthenticated requests so the
// middleware can run `next()` without opening an identity scope (public
// routes don't read identity).
export interface ResolvedAuthIdentity {
  companyId: string;
  companyGroupId: string;
  /** Effective user — console pin-in aware. */
  userId: string;
  /** Raw session/console account. */
  sessionUserId: string;
  email: string;
  /** Resolved API key record — present only for API-key-authenticated requests. */
  apiKeyRecord?: ResolvedApiKeyRecord;
}

// #4: single source for the API key. Reads the `carbon-key` header, falling
// back to a `Authorization: Bearer <token>` when no carbon-key is present.
// Used by BOTH resolveAuthContext (middleware) and requirePermissions so a
// Bearer-token request (e.g. MCP) is recognised by both — previously the
// normalization mutated the request in the MCP route only, which would now
// be a silent break since requirePermissions reads the header itself.
export function resolveApiKey(request: Request): string | null {
  const carbonKey = request.headers.get("carbon-key");
  if (carbonKey) return carbonKey;
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7);
  return null;
}

export async function resolveAuthContext(
  request: Request
): Promise<ResolvedAuthIdentity | null> {
  const apiKey = resolveApiKey(request);

  if (apiKey) {
    const company = await getCompanyIdFromAPIKey(apiKey);
    if (company.data) {
      const apiKeyData = company.data as unknown as ResolvedApiKeyRecord;
      // Expiry is enforced again (with the same message) by
      // requirePermissions' API-key branch; here we only need identity. An
      // expired key still resolves identity — the request is rejected later.
      return {
        companyId: apiKeyData.companyId,
        companyGroupId: apiKeyData.companyGroupId,
        userId: apiKeyData.createdBy,
        sessionUserId: apiKeyData.createdBy,
        email: "",
        apiKeyRecord: apiKeyData
      };
    }
    // Bearer token was present but is NOT a valid API key (e.g. it's a
    // Supabase JWT from client-side code). Fall through to session auth so
    // a request with both a session cookie AND a Bearer JWT is still
    // authenticated by cookie — rejecting here would break session auth for
    // all non-MCP routes.
  }

  // Session path. `requireAuthSession` throws a `redirect(/login)` Response
  // when there is no valid session — the standard "send the user to log in"
  // mechanism for protected routes.
  //
  // The auth middleware runs for EVERY route, including public ones
  // (/login, /callback, /verify, webhooks, …). For a request to a public
  // route that has no session, reaching this point and throwing a redirect
  // to /login would be wrong: the user is supposed to be ON /login. The
  // correct behavior is "no identity scope, render the page."
  //
  // So we catch the redirect and return `null`. The middleware sees `null`
  // and runs `next()` without opening `AuthContextHolder`. Any later code
  // that genuinely needs identity will fail loudly via
  // `AuthContextHolder.get()` (fail-closed). Anything that doesn't need
  // identity (the login page) renders normally. This is the ONLY place
  // where a redirect is intentionally suppressed and the suppression is
  // safe — `next()` with no scope cannot escalate privilege.
  let authSession: Awaited<ReturnType<typeof requireAuthSession>>;
  try {
    authSession = await requireAuthSession(request);
  } catch {
    return null;
  }
  const { companyId, companyGroupId, email, userId } = authSession;
  const consoleMode = authSession.console === companyId;
  return {
    companyId,
    companyGroupId,
    email,
    // EXACT same call requirePermissions uses (line further below) — single
    // source of truth for the effective user.
    userId: getEffectiveUser(request, companyId, userId, consoleMode),
    sessionUserId: userId
  };
}

export async function requirePermissions(
  request: Request,
  requiredPermissions: {
    view?: string | string[];
    create?: string | string[];
    update?: string | string[];
    delete?: string | string[];
    role?: string;
    bypassRls?: boolean;
  }
): Promise<{
  client: SupabaseClient<Database>;
  companyId: string;
  companyGroupId: string;
  email: string;
  userId: string;
  sessionUserId: string;
  consoleMode: boolean;
}> {
  // Prefer identity from `AuthContextHolder` (set by `authContextMiddleware`
  // at module level for protected routes). When no middleware has run (e.g.
  // standalone routes like api+/*, file+/* that have no layout), resolve
  // identity independently via `resolveAuthContext`. Same code paths, same
  // getEffectiveUser call — values are identical by construction.
  const identity =
    AuthContextHolder.tryGet() ?? (await resolveAuthContext(request));
  if (!identity) {
    throw redirect(path.to.login);
  }

  // Same normalization resolveAuthContext used (Bearer → key) so a
  // Bearer-token request takes the API-key branch here too.
  const apiKey = resolveApiKey(request);

  if (apiKey) {
    // Read the resolved API key record from the ALS identity scope — it was
    // fetched ONCE by resolveAuthContext (middleware). We do NOT re-fetch
    // here, which avoids a wasteful DB round-trip AND eliminates a TOCTOU
    // gap where the key could be deleted between the two fetches.
    const apiKeyData = identity.apiKeyRecord;

    if (!apiKeyData) {
      // resolveAuthContext also couldn't resolve this Bearer token as an API
      // key — it's probably a Supabase JWT. Fall through to session auth.
    } else {
      // Identity from the ALS scope (resolveAuthContext derived these from
      // the same apikey). Kept as locals so the rate-limit / scope / plan
      // checks below remain byte-identical.
      const companyId = identity.companyId;
      const companyGroupId = identity.companyGroupId;
      const userId = identity.userId;

      // LOW: Assert consistency — the ALS identity must match the key record.
      if (
        identity.companyId !== apiKeyData.companyId ||
        identity.userId !== apiKeyData.createdBy
      ) {
        throw new Error(
          "Auth context integrity violation: ALS identity differs from API key record"
        );
      }

      // Check expiration
      if (apiKeyData.expiresAt && new Date(apiKeyData.expiresAt) < new Date()) {
        throw new Response("API key has expired", { status: 401 });
      }

      // Check rate limit via Postgres function
      const serviceRole = getCarbonServiceRole();
      const rl = await checkApiKeyRateLimit(
        serviceRole,
        apiKeyData.id,
        apiKeyData.rateLimit,
        apiKeyData.rateLimitWindow
      );
      if (!rl.success) {
        throw new Response("Rate limit exceeded", {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "X-RateLimit-Limit": rl.limit.toString(),
            "X-RateLimit-Remaining": rl.remaining.toString(),
            "X-RateLimit-Reset": rl.resetAt.toString(),
            "Retry-After": Math.ceil(
              (rl.resetAt - Date.now()) / 1000
            ).toString()
          }
        });
      }

      // Update lastUsedAt (fire-and-forget)
      void serviceRole
        .from("apiKey")
        .update({ lastUsedAt: new Date().toISOString() } as any)
        .eq("id" as any, apiKeyData.id);

      // Check scopes against required permissions
      const scopes = apiKeyData.scopes ?? {};
      const scopeCheckPassed = Object.entries(requiredPermissions).every(
        ([action, permission]) => {
          if (action === "bypassRls" || action === "role") return true;
          if (typeof permission === "string") {
            const scopeKey = `${permission}_${action}`;
            return scopeKey in scopes && scopes[scopeKey]?.includes(companyId);
          } else if (Array.isArray(permission)) {
            return permission.every((p) => {
              const scopeKey = `${p}_${action}`;
              return (
                scopeKey in scopes && scopes[scopeKey]?.includes(companyId)
              );
            });
          }
          return false;
        }
      );

      if (!scopeCheckPassed) {
        throw new Response("API key lacks required permissions", {
          status: 403
        });
      }

      // Plan gate: API access is a Business-tier feature. Block Starter
      // companies from authenticating with their API key. Self-hosted editions
      // and bypass-listed companies are never gated.
      if (CarbonEdition === Edition.Cloud) {
        const isBypass = STRIPE_BYPASS_COMPANY_IDS
          ? STRIPE_BYPASS_COMPANY_IDS.split(",")
              .map((id: string) => id.trim())
              .includes(companyId)
          : false;

        if (!isBypass) {
          const { data: planData } = await serviceRole
            .from("companyPlan")
            .select("planId")
            .eq("id", companyId)
            .single();

          if (planData?.planId === Plan.Starter) {
            throw new Response(
              "API access requires the Business plan and above. Please upgrade your plan to use API keys.",
              { status: 403 }
            );
          }
        }
      }

      // Register the authorized client builder (deferred — built lazily on
      // first getAuthClient()). Decision logic unchanged: api-key path always
      // uses the api-key client. Still expose `client` in the return so the
      // ~951 existing callers that destructure it keep working.
      AuthClientScope.setFactory(() => getCarbonAPIKeyClient(apiKey));

      return {
        get client() {
          return getAuthClient<SupabaseClient<Database>>();
        },
        companyId,
        companyGroupId,
        userId,
        sessionUserId: userId,
        email: "",
        consoleMode: false
      };
    }
  }

  // accessToken is a credential, not identity — intentionally NOT in the ALS
  // scope. The session path still needs it to build the RLS client, so we
  // read the session here for the token only. Identity (companyId/userId/…)
  // comes from the ALS scope so it cannot diverge from middleware.
  const authSession = await requireAuthSession(request);
  const accessToken = authSession.accessToken;
  const companyId = identity.companyId;
  const companyGroupId = identity.companyGroupId;
  const email = identity.email;
  // sessionUserId is the raw session user the original code passed to
  // getUserClaims (it used the pre-getEffectiveUser session userId).
  const sessionUserId = identity.sessionUserId;
  // consoleMode must be derived exactly as before — it is true whenever the
  // session is pinned to this company, INDEPENDENT of whether an operator is
  // pinned in (no pin-in ⇒ effective userId == sessionUserId, but console
  // mode is still on). Deriving it from userId!=sessionUserId would be wrong.
  const consoleMode = authSession.console === companyId;

  const myClaims = await getUserClaims(sessionUserId, companyId);

  // early exit if no requiredPermissions are required
  if (Object.keys(requiredPermissions).length === 0) {
    // Same decision, deferred into the lazy client factory. The
    // bypassRls && employee conjunction is UNCHANGED — the sole authorized
    // place serviceRole is chosen.
    AuthClientScope.setFactory(() =>
      requiredPermissions.bypassRls && myClaims.role === "employee"
        ? getCarbonServiceRole()
        : getCarbon(accessToken)
    );
    return {
      get client() {
        return getAuthClient<SupabaseClient<Database>>();
      },
      companyId,
      companyGroupId,
      email,
      // identity.userId is ALREADY the effective user (resolveAuthContext
      // applied getEffectiveUser); do not re-apply it.
      userId: identity.userId,
      sessionUserId,
      consoleMode
    };
  }

  const hasRequiredPermissions = Object.entries(requiredPermissions).every(
    ([action, permission]) => {
      if (action === "bypassRls") return true;
      if (typeof permission === "string") {
        if (action === "role") {
          return myClaims.role === permission;
        }
        if (!(permission in myClaims.permissions)) return false;
        const permissionForCompany =
          myClaims.permissions[permission]?.[
            action as "view" | "create" | "update" | "delete"
          ];
        return (
          permissionForCompany?.includes("0") || // 0 is the wildcard for all companies
          permissionForCompany?.includes(companyId) ||
          false
        );
      } else if (Array.isArray(permission)) {
        return permission.every((p) => {
          const permissionForCompany =
            myClaims.permissions[p]?.[
              action as "view" | "create" | "update" | "delete"
            ];
          return permissionForCompany?.includes(companyId) ?? false;
        });
      } else {
        return false;
      }
    }
  );

  if (!hasRequiredPermissions) {
    if (myClaims.role === null) {
      throw redirect("/", await destroyAuthSession(request));
    }
    throw redirect(
      path.to.authenticatedRoot,
      await flash(
        request,
        error({ myClaims: myClaims, requiredPermissions }, "Access Denied")
      )
    );
  }

  // Same decision (verbatim, incl. the !! at this site), deferred into the
  // lazy factory. Unchanged conjunction; sole authorized serviceRole site.
  AuthClientScope.setFactory(() =>
    !!requiredPermissions.bypassRls && myClaims.role === "employee"
      ? getCarbonServiceRole()
      : getCarbon(accessToken)
  );
  return {
    get client() {
      return getAuthClient<SupabaseClient<Database>>();
    },
    companyId,
    companyGroupId,
    email,
    // identity.userId is already the effective user (see above).
    userId: identity.userId,
    sessionUserId,
    consoleMode
  };
}

export async function resetPassword(accessToken: string, password: string) {
  const { error } = await getCarbon(accessToken).auth.updateUser({
    password
  });

  if (error) return null;

  return true;
}

export async function sendInviteByEmail(
  email: string,
  data?: Record<string, unknown>
) {
  return getCarbonServiceRole().auth.admin.inviteUserByEmail(email, {
    redirectTo: `${VERCEL_URL}/callback`,
    data
  });
}

export async function sendMagicLink(email: string) {
  return getCarbonServiceRole().auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${VERCEL_URL}/callback`
    }
  });
}

export async function signInWithBypassEmail(
  email: string
): Promise<AuthSession | null> {
  const client = getCarbonServiceRole();

  const { data: linkData, error: linkError } =
    await client.auth.admin.generateLink({ type: "magiclink", email });

  if (linkError || !linkData?.properties?.hashed_token) return null;

  const { data: sessionData, error: verifyError } = await client.auth.verifyOtp(
    { token_hash: linkData.properties.hashed_token, type: "magiclink" }
  );

  if (verifyError || !sessionData?.session) return null;

  const companies = await getCompaniesForUser(
    client,
    sessionData.session.user.id
  );
  const { data: companyRecord } = await client
    .from("company")
    .select("companyGroupId")
    .eq("id", companies?.[0] ?? "")
    .single();

  return makeAuthSession(
    sessionData.session,
    companies?.[0] ?? "",
    companyRecord?.companyGroupId ?? ""
  );
}

export async function signInWithEmail(email: string, password: string) {
  const client = getCarbonServiceRole();
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password
  });

  if (!data.session || error) return null;
  const companies = await getCompaniesForUser(client, data.user.id);

  const { data: companyRecord } = await client
    .from("company")
    .select("companyGroupId")
    .eq("id", companies?.[0] ?? "")
    .single();

  return makeAuthSession(
    data.session,
    companies?.[0] ?? "",
    companyRecord?.companyGroupId ?? ""
  );
}

export async function refreshAccessToken(
  refreshToken?: string,
  companyId?: string,
  companyGroupId?: string
): Promise<AuthSession | null> {
  if (!refreshToken) return null;

  const client = getCarbonServiceRole();

  const { data, error } = await client.auth.refreshSession({
    refresh_token: refreshToken
  });

  if (!data.session || error) return null;

  return makeAuthSession(data.session, companyId!, companyGroupId!);
}

export async function verifyAuthSession(authSession: AuthSession) {
  const authAccount = await getAuthAccountByAccessToken(
    authSession.accessToken
  );

  return Boolean(authAccount);
}

export async function signInWithPasskey(
  userId: string,
  email: string
): Promise<AuthSession | null> {
  const serviceRole = getCarbonServiceRole();

  // Generate a one-time magic link without sending an email
  const { data: linkData, error: linkError } =
    await serviceRole.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo: VERCEL_URL }
    });

  if (linkError || !linkData.properties?.hashed_token) return null;

  // Verify the token server-side to obtain a Supabase session
  const { data: sessionData, error: sessionError } =
    await serviceRole.auth.verifyOtp({
      token_hash: linkData.properties.hashed_token,
      type: "magiclink"
    });

  if (sessionError || !sessionData.session) return null;

  const companies = await getCompaniesForUser(serviceRole, userId);
  const { data: companyRecord } = await serviceRole
    .from("company")
    .select("companyGroupId")
    .eq("id", companies?.[0] ?? "")
    .single();

  return makeAuthSession(
    sessionData.session,
    companies?.[0] ?? "",
    companyRecord?.companyGroupId ?? ""
  );
}
