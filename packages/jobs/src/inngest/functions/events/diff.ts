import { auditConfig } from "@carbon/database/audit.config";
import type { AuditDiff } from "@carbon/database/audit.types";
import { tiptapToText } from "@carbon/utils";

// Pure diff computation for the audit handler. Kept free of Inngest / auth
// imports (which require env vars at import time) so it can be unit-tested
// directly — same pattern as ./fk-snapshots.ts.

/**
 * Whether a diff key should be excluded from the audit log. Matches both
 * top-level columns (`"embedding"`) and any nested suffix (`"foo.embedding"`)
 * so vector / metadata columns don't leak when they appear inside JSON
 * containers or under createField allowlists.
 */
function isSkippedAuditKey(key: string): boolean {
  const skip = auditConfig.skipFields as readonly string[];
  for (let i = 0; i < skip.length; i++) {
    const s = skip[i]!;
    if (key === s || key.endsWith(`.${s}`)) return true;
  }
  return false;
}

/**
 * Rich-text (Tiptap) JSONB columns like `internalNotes` / `externalNotes`
 * store a ProseMirror document. Diffing them structurally produces noise
 * (`notes.content: [...]`), so they are treated as atomic values and stored
 * as extracted plain text.
 */
function isTiptapDoc(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as { type?: unknown }).type === "doc"
  );
}

/**
 * Normalize a rich-text column value to plain text. Notes columns default to
 * `{}` before the first edit, so an empty object — like a doc with no text —
 * reads as "" (empty notes), not as a JSON literal.
 */
function richTextToText(value: unknown): string {
  if (isTiptapDoc(value)) {
    // Malformed doc JSON must degrade to "", not throw — an unhandled throw
    // here poisons the event batch and Inngest retries it forever.
    try {
      return tiptapToText(value as Parameters<typeof tiptapToText>[0]);
    } catch {
      return "";
    }
  }
  if (typeof value === "string") return value;
  return "";
}

/**
 * Whether a value is "empty" for diff purposes: null/undefined, an empty
 * string, or an empty object/array. Forms submit `""` / `{}` / `[]` for
 * untouched fields whose DB value is null, so an empty↔empty transition
 * (e.g. `null → {}` on customFields, `null → ""` on a cleared text input)
 * describes no real change — without this guard every first save of a form
 * section logs a diff line per empty field.
 */
function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

/**
 * Compute the diff between old and new record values.
 */
export function computeDiff(
  old: Record<string, unknown>,
  newRecord: Record<string, unknown>
): AuditDiff | null {
  const diff: AuditDiff = {};

  const allKeys = new Set([...Object.keys(old), ...Object.keys(newRecord)]);

  for (const key of allKeys) {
    if (isSkippedAuditKey(key)) continue;

    const oldValue = old[key];
    const newValue = newRecord[key];

    if (isEmptyValue(oldValue) && isEmptyValue(newValue)) continue;

    if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
      if (isTiptapDoc(oldValue) || isTiptapDoc(newValue)) {
        const oldText = richTextToText(oldValue);
        const newText = richTextToText(newValue);
        // Equal text on both sides means an empty↔empty or formatting-only
        // change — not worth an audit row. An empty side is omitted so a
        // first edit renders as a value being set, not "{} → text".
        if (oldText !== newText) {
          diff[key] = {
            ...(oldText !== "" && { old: oldText }),
            ...(newText !== "" && { new: newText })
          };
        }
      } else if (
        typeof oldValue === "object" &&
        oldValue !== null &&
        typeof newValue === "object" &&
        newValue !== null &&
        !Array.isArray(oldValue) &&
        !Array.isArray(newValue)
      ) {
        const nestedDiff = computeNestedDiff(
          oldValue as Record<string, unknown>,
          newValue as Record<string, unknown>,
          key
        );
        Object.assign(diff, nestedDiff);
      } else {
        diff[key] = { old: oldValue, new: newValue };
      }
    }
  }

  return Object.keys(diff).length > 0 ? diff : null;
}

/**
 * Build a diff for INSERT events from an allowlist of columns.
 * Returns null when no fields are configured or none are present on the record.
 * Globally-skipped fields (e.g. `embedding`) are dropped even if listed in
 * `createFields` so vector / metadata noise can't leak into CREATE diffs.
 */
export function computeCreateDiff(
  newRecord: Record<string, unknown>,
  createFields: readonly string[]
): AuditDiff | null {
  if (createFields.length === 0) return null;

  const diff: AuditDiff = {};
  for (const field of createFields) {
    if (isSkippedAuditKey(field)) continue;
    if (field in newRecord) {
      const value = newRecord[field];
      if (isTiptapDoc(value)) {
        const text = richTextToText(value);
        if (text !== "") diff[field] = { new: text };
      } else {
        diff[field] = { new: value };
      }
    }
  }

  return Object.keys(diff).length > 0 ? diff : null;
}

function computeNestedDiff(
  old: Record<string, unknown>,
  newRecord: Record<string, unknown>,
  prefix: string
): AuditDiff {
  const diff: AuditDiff = {};

  const allKeys = new Set([...Object.keys(old), ...Object.keys(newRecord)]);

  for (const key of allKeys) {
    const fullKey = `${prefix}.${key}`;
    if (isSkippedAuditKey(fullKey)) continue;

    const oldValue = old[key];
    const newValue = newRecord[key];

    if (isEmptyValue(oldValue) && isEmptyValue(newValue)) continue;

    if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
      diff[fullKey] = { old: oldValue, new: newValue };
    }
  }

  return diff;
}
