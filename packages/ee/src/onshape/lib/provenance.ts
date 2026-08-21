// Onshape provenance written into `item.notes`.
//
// The contract, and why it is this shape:
//
// `item.notes` is a USER-EDITABLE tiptap document. Every path that touches an
// item from Onshape rewrites its provenance, so a blind overwrite would delete
// whatever an engineer had written on the part. Instead the integration owns a
// DELIMITED BLOCK between two sentinel paragraphs and replaces only that span;
// anything above or below survives by construction.
//
// The sentinels are literal TEXT in ordinary paragraphs, not a custom node type
// and not a custom attribute. ProseMirror's `Node.fromJSON` throws on a node
// type the schema does not declare and silently drops attributes a node spec
// does not declare, so `{ type: "onshapeBlock" }` would break the editor and
// `paragraph attrs: { "data-onshape": … }` would vanish the first time a user
// edited the note. Text survives both.
//
// Rewriting rather than inheriting is correct because `createRevision` does NOT
// copy `notes` (apps/erp/app/modules/items/items.service.ts) — each revision
// starts empty, so a block always describes the release that produced THAT
// revision and never accumulates across a part's history.

import type { Database, Json } from "@carbon/database";
import { textToTiptap, tiptapToText } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A tiptap/ProseMirror node, structurally. Declared here rather than imported
 * from `@tiptap/react` because `packages/ee` does not depend on it — only
 * `packages/utils` does, for the same type. Structural typing makes the two
 * interchangeable at every call site.
 */
export type TiptapNode = {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  text?: string;
  [key: string]: unknown;
};

export const ONSHAPE_NOTES_BLOCK_START = "[onshape-release]";
export const ONSHAPE_NOTES_BLOCK_END = "[/onshape-release]";

export interface OnshapeItemNotesBlockInput {
  /** Release name, when the item was touched by a release. */
  releaseName?: string | null;
  /** Release notes, when the releaser wrote any. */
  releaseNotes?: string | null;
  /** Onshape's part number for the element. */
  partNumber?: string | null;
  /** The released revision letter, or null for an unreleased/BOM-only touch. */
  revision?: string | null;
  documentId?: string | null;
  versionId?: string | null;
  elementId?: string | null;
  partId?: string | null;
  releaseId?: string | null;
  /** ISO instant. Passed in rather than read from the clock so this is pure. */
  importedAt: string;
}

function paragraph(text: string): TiptapNode {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

function labelled(label: string, value: string): TiptapNode {
  return {
    type: "paragraph",
    content: [
      { type: "text", marks: [{ type: "bold" }], text: `${label}: ` },
      { type: "text", text: value }
    ]
  };
}

/**
 * The block's nodes, WITHOUT surrounding document. Deterministic: the same
 * input always produces a byte-identical result, which is what makes the write
 * idempotent across webhook redeliveries and job retries.
 */
export function buildOnshapeItemNotesBlock(
  input: OnshapeItemNotesBlockInput
): TiptapNode[] {
  const body: TiptapNode[] = [];

  body.push(paragraph("Synced from Onshape"));

  if (input.releaseName) body.push(labelled("Release", input.releaseName));
  if (input.partNumber) body.push(labelled("Part number", input.partNumber));
  if (input.revision) body.push(labelled("Revision", input.revision));

  if (input.releaseNotes) {
    body.push(labelled("Release notes", ""));
    // Onshape's notes are plain text with newlines; textToTiptap turns each
    // line into its own paragraph, which is what the editor schema wants.
    body.push(...(textToTiptap(input.releaseNotes).content as TiptapNode[]));
  }

  const identity: string[] = [];
  if (input.documentId) identity.push(`document ${input.documentId}`);
  if (input.versionId) identity.push(`version ${input.versionId}`);
  if (input.elementId) identity.push(`element ${input.elementId}`);
  if (input.partId) identity.push(`part ${input.partId}`);
  if (input.releaseId) identity.push(`release ${input.releaseId}`);
  if (identity.length > 0) body.push(labelled("Onshape", identity.join(" · ")));

  body.push(labelled("Imported", input.importedAt));

  return [
    paragraph(ONSHAPE_NOTES_BLOCK_START),
    ...body,
    paragraph(ONSHAPE_NOTES_BLOCK_END)
  ];
}

function emptyDoc(): TiptapNode {
  return { type: "doc", content: [] };
}

/**
 * `item.notes` is `JSONB DEFAULT '{}'`, so a stored value is legitimately `{}`,
 * `null`, or a real document. Anything that is not a doc becomes an empty one,
 * matching how the readers already guard.
 */
function normalizeDoc(existing: unknown): TiptapNode {
  if (!existing || typeof existing !== "object") return emptyDoc();
  const candidate = existing as TiptapNode;
  if (candidate.type !== "doc") return emptyDoc();
  return { type: "doc", content: [...(candidate.content ?? [])] };
}

/**
 * A node's plain text, read through `tiptapToText` so a sentinel a user has
 * accidentally bolded or italicised still matches — marks live on the text
 * node, not on the string.
 */
function nodeText(node: TiptapNode): string {
  return tiptapToText({ type: "doc", content: [node] }).trim();
}

export interface UpsertOnshapeNotesResult {
  doc: TiptapNode;
  /**
   * A start sentinel was found with no matching end. The block was APPENDED and
   * the orphan left alone — splicing to end-of-document would delete every
   * human-written node after it. Surfaced so the caller can log it.
   */
  orphanedStart: boolean;
}

/**
 * Splice the Onshape block into an existing notes document, replacing any block
 * already there and preserving everything else.
 */
export function upsertOnshapeNotesBlock(
  existing: unknown,
  block: TiptapNode[]
): UpsertOnshapeNotesResult {
  const doc = normalizeDoc(existing);
  const content = doc.content ?? [];

  const start = content.findIndex(
    (node) => nodeText(node) === ONSHAPE_NOTES_BLOCK_START
  );

  if (start === -1) {
    return {
      doc: { type: "doc", content: [...content, ...block] },
      orphanedStart: false
    };
  }

  const endOffset = content
    .slice(start + 1)
    .findIndex((node) => nodeText(node) === ONSHAPE_NOTES_BLOCK_END);

  if (endOffset === -1) {
    // Truncating here would destroy user text. Append instead and report it.
    return {
      doc: { type: "doc", content: [...content, ...block] },
      orphanedStart: true
    };
  }

  const end = start + 1 + endOffset;
  return {
    doc: {
      type: "doc",
      content: [...content.slice(0, start), ...block, ...content.slice(end + 1)]
    },
    orphanedStart: false
  };
}

/**
 * Read an item's notes, splice the Onshape block in, and write it back — but
 * only when the result actually differs from what was read.
 *
 * `serviceRole` is named deliberately, matching `writeElementMapping`: a
 * user-scoped client here would silently match zero rows on the UPDATE and
 * report success, so a wrong client must be obvious at the call site.
 *
 * NON-FATAL by design. Losing a provenance note must never fail an import and
 * send a webhook-driven job around its retry loop — the item, its mappings and
 * its geometry are all already correct by the time this runs. Errors are logged
 * and swallowed, the same posture the release importer takes for the item-name
 * update.
 */
export async function writeOnshapeItemNotes(
  serviceRole: SupabaseClient<Database>,
  args: {
    companyId: string;
    itemId: string;
    userId: string;
    block: TiptapNode[];
  }
): Promise<{ written: boolean; orphanedStart: boolean }> {
  try {
    const existing = await serviceRole
      .from("item")
      .select("notes")
      .eq("id", args.itemId)
      .eq("companyId", args.companyId)
      .maybeSingle();

    if (existing.error) {
      console.error(
        `[ONSHAPE PROVENANCE] could not read notes for item ${args.itemId}`,
        existing.error
      );
      return { written: false, orphanedStart: false };
    }
    if (!existing.data) {
      // The item was deleted between the write that created it and this call.
      return { written: false, orphanedStart: false };
    }

    const { doc, orphanedStart } = upsertOnshapeNotesBlock(
      existing.data.notes,
      args.block
    );

    if (orphanedStart) {
      console.warn(
        `[ONSHAPE PROVENANCE] item ${args.itemId} has an unterminated ${ONSHAPE_NOTES_BLOCK_START} sentinel; appended a fresh block rather than truncating the note`
      );
    }

    // Idempotency at the write layer: a redelivery of the same release produces
    // an identical document, and an UPDATE that changes nothing still writes an
    // audit-log row and fires customer webhooks.
    if (JSON.stringify(existing.data.notes) === JSON.stringify(doc)) {
      return { written: false, orphanedStart };
    }

    const updated = await serviceRole
      .from("item")
      .update({
        // Cast through Json, not through the table's indexed-access type: the
        // deep lookup blows TypeScript's instantiation budget for the whole
        // package and surfaces as unrelated TS2590s in src/accounting.
        notes: doc as unknown as Json,
        updatedBy: args.userId,
        updatedAt: new Date().toISOString()
      })
      .eq("id", args.itemId)
      .eq("companyId", args.companyId);

    if (updated.error) {
      console.error(
        `[ONSHAPE PROVENANCE] could not write notes for item ${args.itemId}`,
        updated.error
      );
      return { written: false, orphanedStart };
    }

    return { written: true, orphanedStart };
  } catch (error) {
    console.error(
      `[ONSHAPE PROVENANCE] unexpected failure writing notes for item ${args.itemId}`,
      error
    );
    return { written: false, orphanedStart: false };
  }
}
