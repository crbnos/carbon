import type { Database } from "@carbon/database";
import type {
  AuthSession as SupabaseAuthSession,
  SupabaseClient,
} from "@supabase/supabase-js";
import { redirect } from "@vercel/remix";
import { REFRESH_ACCESS_TOKEN_THRESHOLD, VERCEL_URL } from "../config/env";
import { getCarbon, getCarbonServiceRole } from "../lib/supabase";
import { path } from "../utils/path";
import {
  destroyAuthSession,
  flash,
  requireAuthSession,
} from "./session.server";
import { getCompaniesForUser } from "./users";
import { getUserClaims } from "./users.server";

import { VerificationEmail } from "@carbon/documents/email";
import { redis } from "@carbon/kv";
import { resend } from "@carbon/lib/resend.server";
import { render } from "@react-email/components";
import { getCarbonAPIKeyClient } from "../lib/supabase/client";
import type { AuthSession } from "../types";
import { error } from "../utils/result";

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
      ...meta,
    },
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
    client.from("user").delete().eq("id", userId),
  ]);

  if (supabaseDelete.error || carbonDelete.error) return null;

  return true;
}

export async function getAuthAccountByAccessToken(accessToken: string) {
  const { data, error } = await getCarbonServiceRole().auth.getUser(
    accessToken
  );

  if (!data.user || error) return null;

  return data.user;
}

function getCompanyIdFromAPIKey(apiKey: string) {
  const serviceRole = getCarbonServiceRole();
  return serviceRole
    .from("apiKey")
    .select("companyId, createdBy")
    .eq("key", apiKey)
    .single();
}

function makeAuthSession(
  supabaseSession: SupabaseAuthSession | null,
  companyId: string
): AuthSession | null {
  if (!supabaseSession) return null;

  if (!supabaseSession.refresh_token)
    throw new Error("User should have a refresh token");

  if (!supabaseSession.user?.email)
    throw new Error("User should have an email");

  return {
    accessToken: supabaseSession.access_token,
    companyId,
    refreshToken: supabaseSession.refresh_token,
    userId: supabaseSession.user.id,
    email: supabaseSession.user.email,
    expiresIn:
      (supabaseSession.expires_in ?? 3000) - REFRESH_ACCESS_TOKEN_THRESHOLD,
    expiresAt: supabaseSession.expires_at ?? -1,
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
  email: string;
  userId: string;
}> {
  const apiKey = request.headers.get("carbon-key");
  if (apiKey) {
    const company = await getCompanyIdFromAPIKey(apiKey);
    if (company.data) {
      const companyId = company.data.companyId;
      const userId = company.data.createdBy;
      const client = getCarbonAPIKeyClient(apiKey);

      return {
        client,
        companyId,
        userId,
        email: "",
      };
    }
  }

  const { accessToken, companyId, email, userId } = await requireAuthSession(
    request
  );

  const myClaims = await getUserClaims(userId, companyId);

  // early exit if no requiredPermissions are required
  if (Object.keys(requiredPermissions).length === 0) {
    return {
      client:
        requiredPermissions.bypassRls && myClaims.role === "employee"
          ? getCarbonServiceRole()
          : getCarbon(accessToken),
      companyId,
      email,
      userId,
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
          myClaims.permissions[permission][
            action as "view" | "create" | "update" | "delete"
          ];
        return (
          permissionForCompany.includes("0") || // 0 is the wildcard for all companies
          permissionForCompany.includes(companyId)
        );
      } else if (Array.isArray(permission)) {
        return permission.every((p) => {
          const permissionForCompany =
            myClaims.permissions[p][
              action as "view" | "create" | "update" | "delete"
            ];
          return permissionForCompany.includes(companyId);
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
    email,
    userId,
  };
}

export async function resetPassword(accessToken: string, password: string) {
  const { error } = await getCarbon(accessToken).auth.updateUser({
    password,
  });

  if (error) return null;

  return true;
}

export async function sendInviteByEmail(
  email: string,
  data?: Record<string, unknown>
) {
  return getCarbonServiceRole().auth.admin.inviteUserByEmail(email, {
    redirectTo: `${VERCEL_URL}`,
    data,
  });
}

export async function sendMagicLink(email: string) {
  return getCarbonServiceRole().auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${VERCEL_URL}`,
    },
  });
}

export async function signInWithEmail(email: string, password: string) {
  const client = getCarbonServiceRole();
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  });

  if (!data.session || error) return null;
  const companies = await getCompaniesForUser(client, data.user.id);

  return makeAuthSession(data.session, companies?.[0]);
}

export async function refreshAccessToken(
  refreshToken?: string,
  companyId?: string
): Promise<AuthSession | null> {
  if (!refreshToken) return null;

  const client = getCarbonServiceRole();

  const { data, error } = await client.auth.refreshSession({
    refresh_token: refreshToken,
  });

  if (!data.session || error) return null;

  return makeAuthSession(data.session, companyId!);
}

export async function verifyAuthSession(authSession: AuthSession) {
  const authAccount = await getAuthAccountByAccessToken(
    authSession.accessToken
  );

  return Boolean(authAccount);
}

export async function sendVerificationCode(email: string) {
  try {
    // Generate 6-digit verification code
    const verificationCode = Math.floor(
      100000 + Math.random() * 900000
    ).toString();

    // Store in Redis with 10-minute expiration
    await redis.set(`verification:${email.toLowerCase()}`, verificationCode, {
      ex: 600,
    });

    // Send email with verification code using React template
    const html = await render(
      VerificationEmail({
        email,
        verificationCode,
      })
    );

    const result = await resend.emails.send({
      from: "Carbon <no-reply@carbonos.dev>",
      to: email,
      subject: "Verify your email address",
      html,
    });

    return !result.error;
  } catch (error) {
    console.error("Failed to send verification code:", error);
    return false;
  }
}

export async function verifyEmailCode(email: string, code: string) {
  try {
    const storedCode = await redis.get(`verification:${email.toLowerCase()}`);

    if (!storedCode || String(storedCode).trim() !== String(code).trim()) {
      return false;
    }

    // Delete the code after successful verification
    await redis.del(`verification:${email.toLowerCase()}`);

    return true;
  } catch (error) {
    console.error("Failed to verify email code:", error);
    return false;
  }
}
