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
  destroyAuthSession,
  flash,
  requireAuthSession
} from "./session.server";
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

/** Hash an OAuth token or secret using SHA-256 for secure storage/lookup */
export function hashOAuthSecret(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

type ApiKeyRecord = {
  id: string;
  companyId: string;
  companyGroupId: string;
  createdBy: string;
  scopes: Record<string, string[]>;
  rateLimit: number;
  rateLimitWindow: "1m" | "1h" | "1d";
  expiresAt: string | null;
};

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
  const apiKey = request.headers.get("carbon-key");

  if (apiKey) {
    const company = await getCompanyIdFromAPIKey(apiKey);
    if (company.data) {
      const apiKeyData = company.data as unknown as ApiKeyRecord;
      const companyId = apiKeyData.companyId;
      const companyGroupId = apiKeyData.companyGroupId;
      const userId = apiKeyData.createdBy;

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

      const client = getCarbonAPIKeyClient(apiKey);

      return {
        client,
        companyId,
        companyGroupId,
        userId,
        sessionUserId: userId,
        email: "",
        consoleMode: false
      };
    }
  }

  const authSession = await requireAuthSession(request);
  const { accessToken, companyId, companyGroupId, email, userId } = authSession;
  const consoleMode = authSession.console === companyId;

  const myClaims = await getUserClaims(userId, companyId);

  // early exit if no requiredPermissions are required
  if (Object.keys(requiredPermissions).length === 0) {
    return {
      client:
        requiredPermissions.bypassRls && myClaims.role === "employee"
          ? getCarbonServiceRole()
          : getCarbon(accessToken),
      companyId,
      companyGroupId,
      email,
      userId: getEffectiveUser(request, companyId, userId, consoleMode),
      sessionUserId: userId,
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

  return {
    client:
      !!requiredPermissions.bypassRls && myClaims.role === "employee"
        ? getCarbonServiceRole()
        : getCarbon(accessToken),
    companyId,
    companyGroupId,
    email,
    userId: getEffectiveUser(request, companyId, userId, consoleMode),
    sessionUserId: userId,
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
