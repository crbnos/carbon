// packages/database/supabase/functions/mcp-embeddings-worker/index.ts
//
// Consumes pgmq 'mcp_embeddings_queue', fetches mcp-tools.json from the ERP
// manifest endpoint, diffs descriptionHash against mcpToolVersion, embeds
// missing rows via Ollama (embeddinggemma:300m, 768-dim), then flips isActive
// atomically. All-or-nothing per manifest — partial failures roll back.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

interface ManifestEntry {
  id: string;
  module: string;
  name: string;
  description: string;
  classification: "READ" | "WRITE" | "DESTRUCTIVE";
  descriptionHash: string;
}
interface Manifest {
  generatedAt: string;
  contentHash: string;
  tools: ManifestEntry[];
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MANIFEST_URL = Deno.env.get("MCP_MANIFEST_URL")!; // e.g. https://erp.example.com/api/mcp/manifest
// Model + endpoint MUST match apps/erp/app/services/mcp/embedQuery.ts.
// Both sides use Ollama `/api/embeddings` (single-input, `{embedding:[]}`
// response). Override via OLLAMA_EMBED_MODEL on both sides simultaneously.
const OLLAMA_URL = Deno.env.get("OLLAMA_URL") ?? "http://ollama:11434";
const OLLAMA_MODEL = Deno.env.get("OLLAMA_EMBED_MODEL") ?? "embeddinggemma:300m";
const CONCURRENCY = 4;

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function readOneMessage(): Promise<{ msgId: number; contentHash: string } | null> {
  const { data, error } = await db.rpc("pgmq_read", {
    queue_name: "mcp_embeddings_queue",
    vt: 60,
    qty: 1
  });
  if (error) throw new Error(`pgmq_read failed: ${error.message}`);
  const row = (data as Array<{ msg_id: number; message: { contentHash: string } }> | null)?.[0];
  return row ? { msgId: row.msg_id, contentHash: row.message.contentHash } : null;
}

async function deleteMessage(msgId: number): Promise<void> {
  const { error } = await db.rpc("pgmq_delete", {
    queue_name: "mcp_embeddings_queue",
    msg_id: msgId
  });
  if (error) console.warn(`pgmq_delete failed: ${error.message}`);
}

async function fetchManifest(): Promise<Manifest> {
  const res = await fetch(MANIFEST_URL, {
    headers: { "x-supabase-service-role": SERVICE_ROLE_KEY }
  });
  if (!res.ok) throw new Error(`manifest fetch ${res.status}`);
  return (await res.json()) as Manifest;
}

async function existingHashes(hashes: string[]): Promise<Set<string>> {
  if (hashes.length === 0) return new Set();
  const { data, error } = await db
    .from("mcpToolVersion")
    .select("descriptionHash")
    .in("descriptionHash", hashes);
  if (error) throw new Error(`select existing failed: ${error.message}`);
  return new Set((data ?? []).map((r) => r.descriptionHash));
}

async function embed(text: string): Promise<number[]> {
  const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: OLLAMA_MODEL, prompt: text })
  });
  if (!res.ok) throw new Error(`ollama ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { embedding: number[] };
  if (!Array.isArray(json.embedding) || json.embedding.length === 0) {
    throw new Error(`unexpected embedding shape: len=${json.embedding?.length}`);
  }
  // The `mcpToolEmbedding.embedding` column is `vector(768)`. Any model that
  // returns a different dim will fail at insert time — fail earlier with a
  // clearer message.
  if (json.embedding.length !== 768) {
    throw new Error(
      `embedding dim ${json.embedding.length} != 768 (model=${OLLAMA_MODEL}); column is vector(768)`
    );
  }
  return json.embedding;
}

async function embedAllConcurrent(
  entries: ManifestEntry[]
): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  let i = 0;
  async function worker(): Promise<void> {
    while (i < entries.length) {
      const idx = i++;
      const e = entries[idx];
      out.set(e.descriptionHash, await embed(e.description));
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, entries.length) }, worker));
  return out;
}

async function applyManifest(
  tools: ManifestEntry[],
  embeddings: Map<string, number[]>
): Promise<void> {
  const newRows = tools
    .filter((t) => embeddings.has(t.descriptionHash))
    .map((t) => ({
      toolId: t.id,
      module: t.module,
      name: t.name,
      description: t.description,
      classification: t.classification,
      descriptionHash: t.descriptionHash,
      embedding: embeddings.get(t.descriptionHash)!
    }));
  const activeHashes = tools.map((t) => t.descriptionHash);
  const activeToolIds = tools.map((t) => t.id);

  const { error } = await db.rpc("apply_mcp_manifest", {
    new_rows: newRows,
    active_hashes: activeHashes,
    active_tool_ids: activeToolIds
  });
  if (error) throw new Error(`apply_mcp_manifest: ${error.message}`);
}

Deno.serve(async () => {
  try {
    const msg = await readOneMessage();
    if (!msg) return new Response("no message", { status: 200 });

    const manifest = await fetchManifest();
    if (manifest.contentHash !== msg.contentHash) {
      console.log(
        `[mcp-worker] contentHash mismatch (msg=${msg.contentHash} live=${manifest.contentHash}) — using live manifest`
      );
    }

    const have = await existingHashes(manifest.tools.map((t) => t.descriptionHash));
    const missing = manifest.tools.filter((t) => !have.has(t.descriptionHash));
    console.log(`[mcp-worker] tools=${manifest.tools.length} missing=${missing.length}`);

    const embeddings = await embedAllConcurrent(missing);
    await applyManifest(manifest.tools, embeddings);
    await deleteMessage(msg.msgId);
    return new Response(JSON.stringify({ ok: true, embedded: missing.length }), {
      headers: { "content-type": "application/json" }
    });
  } catch (err) {
    console.error("[mcp-worker] failed", err);
    return new Response(String(err), { status: 500 });
  }
});
