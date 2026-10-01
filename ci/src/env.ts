// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import * as dotenv from "dotenv";
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SUPABASE_SERVICE_ROLE_KEY = process.env
  .SUPABASE_SERVICE_ROLE_KEY as string;
const SUPABASE_ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN as string;
const SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID = process.env
  .SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID as string;
const SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET = process.env
  .SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET as string;
const SUPABASE_AUTH_EXTERNAL_GOOGLE_REDIRECT_URI = process.env
  .SUPABASE_AUTH_EXTERNAL_GOOGLE_REDIRECT_URI as string;

if (!SUPABASE_ACCESS_TOKEN) throw new Error("Missing SUPABASE_ACCESS_TOKEN");
if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL");
if (!SUPABASE_SERVICE_ROLE_KEY)
  throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

export {
  SUPABASE_ACCESS_TOKEN,
  SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID,
  SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET,
  SUPABASE_AUTH_EXTERNAL_GOOGLE_REDIRECT_URI,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_URL,
};
