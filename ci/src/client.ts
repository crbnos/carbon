import { createClient } from "@supabase/supabase-js";
import { SUPABASE_SERVICE_ROLE, SUPABASE_URL } from "./env";

export const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);
