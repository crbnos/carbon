// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { FLAGS } from "@carbon/env/flags";
import { MemoryStorage } from "@openfeature/flagd-core";

// The data: URL rides in the ECS task definition, which AWS caps at 64 KiB in
// total, so the document gets a much smaller cap than the provider's 1 MB.
const MAX_FLAGS_DOCUMENT_BYTES = 32 * 1024;

/**
 * The workspace's feature flags document as a `data:` URL for
 * `CARBON_FLAGS_ENDPOINT`. The instance loads it once and never calls the
 * source at runtime. Throws on any failure.
 */
export async function fetchFlagsDocument(
  endpoint: string,
  token: string | null,
  commit: string
): Promise<string> {
  if (token && !endpoint.startsWith("https://")) {
    throw new Error("flags_endpoint must use https: when flags_token is set");
  }
  const res = await fetch(endpoint, {
    headers: {
      // 12 characters, as the apps send it.
      "X-Carbon-Commit": commit.slice(0, 12),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`The flags source answered ${res.status}`);
  }
  if (Number(res.headers.get("content-length") ?? 0) > MAX_FLAGS_DOCUMENT_BYTES) {
    throw new Error("The flags document is larger than 32 KiB");
  }
  // Read through a cap, so a wrong endpoint never downloads a large file.
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of res.body ?? []) {
    size += chunk.byteLength;
    if (size > MAX_FLAGS_DOCUMENT_BYTES) {
      throw new Error("The flags document is larger than 32 KiB");
    }
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks).toString("utf8");
  assertFlagdDocument(body);
  return `data:application/json;base64,${Buffer.from(body).toString("base64")}`;
}

// flagd-core's strict mode checks the flag and targeting schemas that the
// provider's lenient parse only logs, and every registered flag is a boolean
// (`@carbon/env/flags`). A bad document fails the deploy instead of running a
// whole release on code defaults.
const silent = { debug() {}, info() {}, warn() {}, error() {} };

export function assertFlagdDocument(body: string): void {
  new MemoryStorage(silent).setConfigurations(body, true);
  const { flags } = JSON.parse(body) as {
    flags: Record<string, { variants?: Record<string, unknown> }>;
  };
  for (const key of Object.keys(FLAGS)) {
    const variants = Object.values(flags[key]?.variants ?? {});
    if (variants.some((value) => typeof value !== "boolean")) {
      throw new Error(`Flag "${key}" must have boolean variants`);
    }
  }
}
