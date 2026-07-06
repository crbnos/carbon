import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";
import {
  SUPABASE_JWT_SECRET,
  SUPABASE_SERVICE_ROLE_KEY
} from "../../config/env";
import { getCarbon, getCarbonClient } from "./client";

export const getCarbonServiceRole = (): SupabaseClient<Database> => {
  return getCarbonClient(SUPABASE_SERVICE_ROLE_KEY!);
};

export async function getUserScopedClient(
  userId: string
): Promise<SupabaseClient<Database>> {
  if (!SUPABASE_JWT_SECRET) {
    throw new Error("SUPABASE_JWT_SECRET is required for user-scoped clients");
  }

  const secret = new TextEncoder().encode(SUPABASE_JWT_SECRET);
  const jwt = await new SignJWT({
    sub: userId,
    aud: "authenticated",
    role: "authenticated"
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(secret);

  return getCarbon(jwt);
}
