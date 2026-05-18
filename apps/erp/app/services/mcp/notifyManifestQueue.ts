import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { SupabaseClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = resolve(__dirname, "./mcp-tools.json");

export async function notifyManifestQueue(
  client: SupabaseClient
): Promise<void> {
  let contentHash: string;
  try {
    const parsed = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as {
      contentHash: string;
    };
    contentHash = parsed.contentHash;
  } catch (err) {
    console.error(
      "[mcp] notifyManifestQueue: cannot read manifest, skipping",
      err
    );
    return;
  }

  const { error } = await client.rpc("pgmq_send", {
    queue_name: "mcp_embeddings_queue",
    message: { contentHash }
  });
  if (error) {
    // Fire-and-forget: another instance will send the same message, or the
    // next deploy will. Don't crash boot.
    console.warn("[mcp] notifyManifestQueue: rpc error", error.message);
  }
}
