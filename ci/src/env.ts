import * as dotenv from "dotenv";
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string;
const SUPABASE_ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN as string;

if (!SUPABASE_ACCESS_TOKEN) throw new Error("Missing SUPABASE_ACCESS_TOKEN");
if (!SUPABASE_URL) throw new Error("Missing SUPABSE_URL");
if (!SUPABASE_SERVICE_ROLE_KEY)
  throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

export { SUPABASE_ACCESS_TOKEN, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL };
