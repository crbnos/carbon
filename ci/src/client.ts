import { createClient } from "@supabase/supabase-js";
import { SUPABASE_SERVICE_ROLE, SUPABASE_URL } from "./env";

export const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

export type Customer = {
  id: number;
  name: string;
  slug: string;
  active: boolean;
  seeded: boolean;
  database_url: string | null;
  project_id: string | null;
  decrypted_access_token: string | null;
  decrypted_anon_key: string | null;
  decrypted_database_password: string | null;
  decrypted_jwt_key: string | null;
  decrypted_service_role_key: string | null;
  latest_migration: string | null;
};
