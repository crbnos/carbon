import type { Database } from "@carbon/database";
import type {
  AuthSession as SupabaseAuthSession,
  SupabaseClient,
} from "@supabase/supabase-js";
import {
  REFRESH_ACCESS_TOKEN_THRESHOLD,
  SUPABASE_API_URL,
  VERCEL_URL,
} from "~/config/env";
import logger from "~/lib/logger";
import { getSupabaseServiceRole } from "~/lib/supabase";
import type { AuthSession } from "./types";

export async function getAuthAccountByAccessToken(accessToken: string) {
  const { data, error } = await getSupabaseServiceRole().auth.getUser(
    accessToken
  );

  if (!data.user || error) return null;

  return data.user;
}

export async function getCompanies(
  client: SupabaseClient<Database>,
  userId: string
) {
  const companies = await client
    .from("companies")
    .select("*")
    .eq("userId", userId)
    .order("name");

  if (companies.error) {
    return companies;
  }

  return {
    data: companies.data.map((company) => ({
      ...company,
      logo: company.logo
        ? `${SUPABASE_API_URL}/storage/v1/object/public/public/${company.logo}`
        : null,
    })),
    error: null,
  };
}

export async function getCompaniesForUser(
  client: SupabaseClient<Database>,
  userId: string
) {
  const { data, error } = await client
    .from("userToCompany")
    .select("companyId")
    .eq("userId", userId);

  if (error) {
    logger.error(error, `Failed to get companies for user ${userId}`);
    return [];
  }

  return data?.map((row) => row.companyId) ?? [];
}

export async function getUser(client: SupabaseClient<Database>, id: string) {
  return client
    .from("user")
    .select("*")
    .eq("id", id)
    .eq("active", true)
    .single();
}

export async function getUserByEmail(email: string) {
  return getSupabaseServiceRole()
    .from("user")
    .select("*")
    .eq("email", email)
    .maybeSingle();
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

export async function sendMagicLink(email: string) {
  return getSupabaseServiceRole().auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${VERCEL_URL}/callback`,
    },
  });
}

export async function signInWithEmail(email: string, password: string) {
  const client = getSupabaseServiceRole();
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

  const client = getSupabaseServiceRole();

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
