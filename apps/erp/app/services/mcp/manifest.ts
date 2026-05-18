import { createHash } from "node:crypto";
import type { McpClassification, McpToolMetadata } from "./types";

export interface ManifestEntry {
  id: string;
  module: string;
  name: string;
  description: string;
  classification: McpClassification;
  descriptionHash: string;
}

export interface Manifest {
  generatedAt: string;
  contentHash: string;
  tools: ManifestEntry[];
}

function sha256(input: string): string {
  return "sha256:" + createHash("sha256").update(input).digest("hex");
}

export function hashDescription(input: {
  id: string;
  description: string;
  classification: McpClassification;
}): string {
  return sha256(`${input.id}\n${input.description}\n${input.classification}`);
}

export function toManifestEntry(t: McpToolMetadata): ManifestEntry {
  const description = t.description.trim();
  return {
    id: t.id,
    module: t.module,
    name: t.name,
    description,
    classification: t.classification,
    descriptionHash: hashDescription({
      id: t.id,
      description,
      classification: t.classification
    })
  };
}

// Canonical JSON: deterministic key order + no incidental whitespace.
function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return "[" + value.map(canonicalStringify).join(",") + "]";
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return (
    "{" +
    keys
      .map(
        (k) =>
          JSON.stringify(k) +
          ":" +
          canonicalStringify((value as Record<string, unknown>)[k])
      )
      .join(",") +
    "}"
  );
}

export function buildManifest(
  tools: McpToolMetadata[],
  now: Date = new Date()
): Manifest {
  const entries = tools
    .filter((t) => !t.disable)
    .map(toManifestEntry)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    generatedAt: now.toISOString(),
    contentHash: sha256(canonicalStringify(entries)),
    tools: entries
  };
}
