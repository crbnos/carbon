#!/usr/bin/env node
// Generate the Supabase self-host key trio for the Carbon Swarm stack.
//
//   SUPABASE_JWT_SECRET        — HMAC secret every Supabase service signs/verifies with
//   SUPABASE_ANON_KEY          — JWT(role=anon)         signed with that secret
//   SUPABASE_SERVICE_ROLE_KEY  — JWT(role=service_role) signed with that secret
//
// The anon/service_role keys MUST be signed with the printed JWT secret — the
// three are a matched set. `deploy.sh init` consumes this output to create the
// `jwt_secret`, `anon_key`, and `service_role_key` Docker secrets together.
// Re-running mints a fresh, incompatible set.
//
// Usage: node scripts/gen-supabase-keys.mjs
// Zero dependencies (Node built-in crypto only).

import { createHmac, randomBytes } from "node:crypto";

const b64url = (buf) =>
  Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

function signJwt(payload, secret) {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const data = `${header}.${body}`;
  const sig = b64url(createHmac("sha256", secret).update(data).digest());
  return `${data}.${sig}`;
}

const jwtSecret = randomBytes(32).toString("hex"); // 64 hex chars
const iat = Math.floor(Date.now() / 1000);
const exp = iat + 60 * 60 * 24 * 365 * 10; // 10 years

const anon = signJwt({ role: "anon", iss: "supabase", iat, exp }, jwtSecret);
const service = signJwt(
  { role: "service_role", iss: "supabase", iat, exp },
  jwtSecret
);

process.stdout.write(
  [
    "# --- Supabase self-host keys (generated) ---",
    `SUPABASE_JWT_SECRET=${jwtSecret}`,
    `SUPABASE_ANON_KEY=${anon}`,
    `SUPABASE_SERVICE_ROLE_KEY=${service}`,
    "",
  ].join("\n")
);
