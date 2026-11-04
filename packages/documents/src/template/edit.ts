// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { z } from "zod";
import type {
  DocumentBlock,
  DocumentTemplate,
  DocumentTemplateType
} from "./schema";
import { getTextEntries } from "./texts";
import type { TextEntry } from "./texts/types";

/**
 * Edits to one document (one PO, one invoice...) on top of the company template.
 * Only the changes are kept, in the template's own shape, so a word the document
 * did not change still follows the template. Stored in `documentEdit`.
 */
export const blockEditSchema = z.object({
  text: z.record(z.string(), z.string()).optional(),
  hidden: z.array(z.string()).optional(),
  visible: z.boolean().optional(),
  /** The Terms block's own rich text for this document. */
  content: z.any().optional()
});

export const documentEditSchema = z.object({
  /** Keyed by the template's block id (a built-in block's id is its type). */
  blocks: z.record(z.string(), blockEditSchema).default({}),
  settings: z
    .object({
      text: z.record(z.string(), z.string()).optional(),
      hidden: z.array(z.string()).optional()
    })
    .default({})
});

export type BlockEdit = z.infer<typeof blockEditSchema>;
export type DocumentEdit = z.infer<typeof documentEditSchema>;

/** The documents one record can edit; labels belong to an item, not a document. */
export const DOCUMENT_EDIT_TYPES = [
  "purchaseOrder",
  "purchaseReturnOrder",
  "purchasingRfq",
  "quote",
  "salesOrder",
  "salesReturnOrder",
  "salesInvoice",
  "packingSlip",
  "stockTransfer",
  "jobTraveler",
  "issue"
] as const satisfies readonly DocumentTemplateType[];

export type DocumentEditType = (typeof DOCUMENT_EDIT_TYPES)[number];

export function isDocumentEditType(type: string): type is DocumentEditType {
  return (DOCUMENT_EDIT_TYPES as readonly string[]).includes(type);
}

/** The template as this one document prints it. */
export function applyDocumentEdit(
  template: DocumentTemplate,
  edit: DocumentEdit | null
): DocumentTemplate {
  if (!edit) return template;
  return {
    ...template,
    blocks: template.blocks.map((block) => {
      const change = edit.blocks[block.id];
      if (!change) return block;
      const next = {
        ...block,
        text: { ...block.text, ...change.text },
        hidden: change.hidden ?? block.hidden,
        visible: change.visible ?? block.visible
      };
      if (block.type === "terms" && change.content !== undefined) {
        return { ...next, content: change.content };
      }
      return next as DocumentBlock;
    }),
    settings: {
      ...template.settings,
      text: { ...template.settings.text, ...edit.settings.text },
      hidden: edit.settings.hidden ?? template.settings.hidden
    }
  };
}

/** What a word prints: the stored text, else the catalog's default. */
function printed(
  entries: readonly TextEntry[],
  stored: Record<string, string> | undefined
) {
  return new Map(
    entries.map((entry) => [entry.key, stored?.[entry.key] ?? entry.default])
  );
}

const sameList = (a: string[] | undefined, b: string[] | undefined) =>
  JSON.stringify([...(a ?? [])].sort()) ===
  JSON.stringify([...(b ?? [])].sort());

/** Only the words, toggles and terms that differ from the template. */
function changedText(
  entries: readonly TextEntry[],
  base: Record<string, string> | undefined,
  edited: Record<string, string> | undefined
) {
  const before = printed(entries, base);
  const after = printed(entries, edited);
  const text = Object.fromEntries(
    [...after].filter(([key, value]) => before.get(key) !== value)
  );
  return Object.keys(text).length > 0 ? text : undefined;
}

/**
 * The edit that turns `base` (the company template) into `edited` (what the user
 * left in the editor). A word set back to the template's word leaves no key.
 */
export function diffDocumentEdit(
  documentType: DocumentTemplateType,
  base: DocumentTemplate,
  edited: Pick<DocumentTemplate, "blocks" | "settings">
): DocumentEdit {
  const blocks: Record<string, BlockEdit> = {};
  for (const block of base.blocks) {
    const after = edited.blocks.find((b) => b.id === block.id);
    if (!after) continue;
    const change: BlockEdit = {};
    const text = changedText(
      getTextEntries(documentType, block.type),
      block.text,
      after.text
    );
    if (text) change.text = text;
    if (!sameList(block.hidden, after.hidden))
      change.hidden = after.hidden ?? [];
    if (block.visible !== after.visible) change.visible = after.visible;
    if (
      block.type === "terms" &&
      after.type === "terms" &&
      JSON.stringify(block.content ?? null) !==
        JSON.stringify(after.content ?? null)
    ) {
      change.content = after.content;
    }
    if (Object.keys(change).length > 0) blocks[block.id] = change;
  }

  const settings: DocumentEdit["settings"] = {};
  const text = changedText(
    getTextEntries(documentType, "document"),
    base.settings.text,
    edited.settings.text
  );
  if (text) settings.text = text;
  if (!sameList(base.settings.hidden, edited.settings.hidden)) {
    settings.hidden = edited.settings.hidden ?? [];
  }

  return { blocks, settings };
}

export function isEmptyDocumentEdit(edit: DocumentEdit): boolean {
  return (
    Object.keys(edit.blocks).length === 0 &&
    Object.keys(edit.settings).length === 0
  );
}
