import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { LoaderFunctionArgs } from "react-router";

// Resolve the manifest relative to this source file so the route works
// regardless of which directory the server process is launched from.
const __dirname = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = resolve(
  __dirname,
  "../../../services/mcp/mcp-tools.json"
);

interface CachedManifest {
  raw: string;
  contentHash: string;
}

let cached: CachedManifest | null = null;

function loadManifest(): CachedManifest {
  if (cached) return cached;
  const raw = readFileSync(MANIFEST_PATH, "utf8");
  const parsed = JSON.parse(raw) as { contentHash: string };
  cached = { raw, contentHash: parsed.contentHash };
  return cached;
}

export async function loader({
  request
}: LoaderFunctionArgs): Promise<Response> {
  const expected = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const presented = request.headers.get("x-supabase-service-role");
  if (!expected || presented !== expected) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { raw, contentHash } = loadManifest();
  const etag = `"${contentHash}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { etag } });
  }
  return new Response(raw, {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      etag,
      "cache-control": "no-cache"
    }
  });
}
