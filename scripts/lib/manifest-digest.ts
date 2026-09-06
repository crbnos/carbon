/**
 * A small, committed summary of the generated tool manifest.
 *
 * `tool-metadata.json` itself is build-time output and gitignored — at 1.3 MB and
 * rewritten wholesale on every regeneration, it churned 250+ commits. But it was
 * also the only place a schema change was VISIBLE in review: the phantom-property
 * bug (an operation publishing 58 arguments where its validator has 15) was caught
 * by reading that diff.
 *
 * The digest keeps that signal at a fifth of the size, one line per operation, and
 * does not grow when schemas do (only the hash of one changes). It records the
 * facts a reviewer needs to notice a regression — classification, permission,
 * injected auth fields, the argument count, and a hash of the schema — so a changed
 * schema always shows up as a changed line, and a changed COUNT shows up as a
 * number a human can judge.
 */

import { createHash } from "crypto";
import type { ManifestEntry } from "@carbon/api";

/** One line per operation: enough to spot a regression, not enough to churn. */
export interface DigestEntry {
  name: string;
  classification: string;
  paramCount: number;
  /** Stable hash of the input schema — any shape change moves it. */
  schema: string;
  /** Stable hash of the response schema, or "none" when none was derived. */
  response: string;
  injectAuth: string;
  permission: string;
}

export interface ManifestDigest {
  totalTools: number;
  modules: number;
  tools: DigestEntry[];
}

/**
 * Hash with sorted keys so an incidental reordering of object properties — which
 * JSON.stringify preserves but which means nothing semantically — does not read as
 * a schema change.
 */
function stableHash(value: unknown): string {
  const canonical = JSON.stringify(sortKeys(value));
  return createHash("sha256").update(canonical).digest("hex").slice(0, 12);
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/**
 * Serialize with ONE LINE PER OPERATION. Pretty-printing spreads each entry over
 * six lines, so a single changed schema reads as a six-line hunk; one line per
 * operation makes a changed operation exactly one changed line — which is the
 * whole point of keeping this file.
 */
export function serializeManifestDigest(digest: ManifestDigest): string {
  const lines = digest.tools.map((t) => `    ${JSON.stringify(t)}`);
  return [
    "{",
    `  "totalTools": ${digest.totalTools},`,
    `  "modules": ${digest.modules},`,
    '  "tools": [',
    lines.join(",\n"),
    "  ]",
    "}",
    ""
  ].join("\n");
}

export function buildManifestDigest(tools: ManifestEntry[]): ManifestDigest {
  return {
    totalTools: tools.length,
    modules: new Set(tools.map((t) => t.module)).size,
    // Sorted by name: the generator walks modules in a fixed order today, but the
    // digest is a committed file and must not reorder because a service file moved.
    tools: [...tools]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((t) => ({
        name: t.name,
        classification: t.classification,
        paramCount: t.paramCount,
        schema: stableHash(t.schema),
        response: t.responseSchema ? stableHash(t.responseSchema) : "none",
        injectAuth: [...t.injectAuth].sort().join("+") || "none",
        permission: t.permission?.module
          ? `${t.permission.module}:${[...t.permission.actions].sort().join("+")}`
          : "none"
      }))
  };
}

export interface DigestDiff {
  added: string[];
  removed: string[];
  changed: Array<{ name: string; before: DigestEntry; after: DigestEntry }>;
}

export function diffDigests(
  before: ManifestDigest,
  after: ManifestDigest
): DigestDiff {
  const beforeByName = new Map(before.tools.map((t) => [t.name, t]));
  const afterByName = new Map(after.tools.map((t) => [t.name, t]));

  const changed: DigestDiff["changed"] = [];
  for (const [name, entry] of afterByName) {
    const prev = beforeByName.get(name);
    if (!prev) continue;
    if (JSON.stringify(prev) !== JSON.stringify(entry)) {
      changed.push({ name, before: prev, after: entry });
    }
  }

  return {
    added: [...afterByName.keys()].filter((n) => !beforeByName.has(n)).sort(),
    removed: [...beforeByName.keys()].filter((n) => !afterByName.has(n)).sort(),
    changed
  };
}

/** Human-readable summary of a digest diff, for the check script's output. */
export function formatDigestDiff(diff: DigestDiff): string {
  const lines: string[] = [];
  for (const name of diff.added) lines.push(`  + ${name}`);
  for (const name of diff.removed) lines.push(`  - ${name}`);
  for (const { name, before, after } of diff.changed) {
    const parts: string[] = [];
    if (before.paramCount !== after.paramCount) {
      parts.push(`args ${before.paramCount} → ${after.paramCount}`);
    }
    if (before.classification !== after.classification) {
      parts.push(`${before.classification} → ${after.classification}`);
    }
    if (before.permission !== after.permission) {
      parts.push(`permission ${before.permission} → ${after.permission}`);
    }
    if (before.injectAuth !== after.injectAuth) {
      parts.push(`injectAuth ${before.injectAuth} → ${after.injectAuth}`);
    }
    if (before.schema !== after.schema) parts.push("input schema changed");
    if (before.response !== after.response) {
      if (before.response === "none") parts.push("response added");
      else if (after.response === "none") parts.push("response LOST");
      else parts.push("response schema changed");
    }
    lines.push(`  ~ ${name}: ${parts.join(", ")}`);
  }
  return lines.join("\n");
}
