import { createClient } from "@supabase/supabase-js";
import { SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL } from "./env";

export const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
