// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { JSONContent } from "@carbon/react";
import { z } from "zod";
import { lockedTokens } from "./mergeFields";
import type {
  DocumentBlock,
  DocumentTemplate,
  DocumentTemplateType
} from "./schema";
import { valueEditsSchema } from "./schema";
import { getTextEntries } from "./texts";
import type { TextEntry } from "./texts/types";
import { type TextProblem, validateTemplateText } from "./texts/validate";
import { isEmptyValueEdits } from "./values";

/**
 * Edits to one document (one PO, one invoice...) on top of the company template.
 * Only the changes are kept, in the template's own shape, so a word the document
 * did not change still follows the template. Stored in `documentEdit`.
 */
export const blockEditSchema = z.object({
  text: z.record(z.string(), z.string()).optional(),
  /** Texts this document hides, or shows, against the template's hidden list. */
  hide: z.array(z.string()).optional(),
  show: z.array(z.string()).optional(),
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
      hide: z.array(z.string()).optional(),
      show: z.array(z.string()).optional(),
      valueEdits: valueEditsSchema.optional()
    })
    .default({})
});

export type BlockEdit = z.infer<typeof blockEditSchema>;
export type DocumentEdit = z.infer<typeof documentEditSchema> & {
  /**
   * The modal's unsaved notes, for a preview or download only. `documentEdit`
   * has no column for them: a save writes them to the record.
   */
  notes?: JSONContent | null;
};

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

/**
 * A Notes block carrying the modal's unsaved notes. Only `applyDocumentEdit` sets
 * this: `blockSchema` has no such field, so nothing posted or saved can.
 */
type BlockWithDraftNotes = DocumentBlock & {
  draftNotes?: JSONContent | null;
};

/** What an edit changes in how a block prints, beyond the block's own entry. */
function forPrinting(
  block: DocumentBlock,
  edit: DocumentEdit
): BlockWithDraftNotes {
  // A changed line can run longer than the record's, so the table wraps it
  // rather than cutting it off at one line.
  if (
    block.type === "lineItems" &&
    Object.keys(edit.settings.valueEdits?.rows ?? {}).length > 0
  ) {
    return {
      ...block,
      options: { ...block.options, textOverflow: "wrap" }
    } as DocumentBlock;
  }
  if (block.type === "notes" && edit.notes !== undefined) {
    return { ...block, draftNotes: edit.notes };
  }
  return block;
}

/** What a Notes block prints: the modal's unsaved notes, else the record's. */
export function printedNotes(
  block: BlockWithDraftNotes,
  recordNotes: unknown
): JSONContent | null | undefined {
  return "draftNotes" in block
    ? block.draftNotes
    : (recordNotes as JSONContent | null | undefined);
}

/** The template's hidden list with this document's own changes to it. */
function hiddenWith(
  hidden: string[] | undefined,
  change: { hide?: string[]; show?: string[] }
) {
  if (!change.hide && !change.show) return hidden;
  const kept = (hidden ?? []).filter((key) => !change.show?.includes(key));
  return [...new Set([...kept, ...(change.hide ?? [])])];
}

/** The template as this one document prints it. */
export function applyDocumentEdit<
  T extends Pick<DocumentTemplate, "blocks" | "settings">
>(template: T, edit: DocumentEdit | null): T {
  if (!edit) return template;
  return {
    ...template,
    blocks: template.blocks.map((original) => {
      const block = forPrinting(original, edit);
      const change = edit.blocks[block.id];
      if (!change) return block;
      const next = {
        ...block,
        text: { ...block.text, ...change.text },
        hidden: hiddenWith(block.hidden, change),
        visible: change.visible ?? block.visible
      };
      if (block.type === "terms" && change.content !== undefined) {
        return { ...next, content: change.content ?? undefined };
      }
      return next as DocumentBlock;
    }),
    settings: {
      ...template.settings,
      text: { ...template.settings.text, ...edit.settings.text },
      hidden: hiddenWith(template.settings.hidden, edit.settings),
      valueEdits: edit.settings.valueEdits
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

/** What the edited hidden list adds to the template's, and takes from it. */
function hiddenChange(
  base: string[] | undefined,
  edited: string[] | undefined
) {
  const hide = (edited ?? []).filter((key) => !base?.includes(key));
  const show = (base ?? []).filter((key) => !edited?.includes(key));
  return {
    ...(hide.length > 0 ? { hide } : {}),
    ...(show.length > 0 ? { show } : {})
  };
}

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
  base: Pick<DocumentTemplate, "blocks" | "settings">,
  edited: Pick<DocumentTemplate, "blocks" | "settings">
): DocumentEdit {
  const blocks: Record<string, BlockEdit> = {};
  for (const block of base.blocks) {
    const after = edited.blocks.find((b) => b.id === block.id);
    if (!after) continue;
    const change: BlockEdit = hiddenChange(block.hidden, after.hidden);
    const text = changedText(
      getTextEntries(documentType, block.type),
      block.text,
      after.text
    );
    if (text) change.text = text;
    if (block.visible !== after.visible) change.visible = after.visible;
    if (
      block.type === "terms" &&
      after.type === "terms" &&
      JSON.stringify(block.content ?? null) !==
        JSON.stringify(after.content ?? null)
    ) {
      // Null: the template's terms are cleared here, and the company's print.
      change.content = after.content ?? null;
    }
    if (Object.keys(change).length > 0) blocks[block.id] = change;
  }

  const settings: DocumentEdit["settings"] = hiddenChange(
    base.settings.hidden,
    edited.settings.hidden
  );
  const text = changedText(
    getTextEntries(documentType, "document"),
    base.settings.text,
    edited.settings.text
  );
  if (text) settings.text = text;
  if (!isEmptyValueEdits(edited.settings.valueEdits)) {
    settings.valueEdits = edited.settings.valueEdits;
  }

  return { blocks, settings };
}

export function isEmptyDocumentEdit(edit: DocumentEdit): boolean {
  return (
    Object.keys(edit.blocks).length === 0 &&
    Object.keys(edit.settings).length === 0
  );
}

/**
 * What an edit itself gets wrong. A company template's own problem is left out:
 * this document cannot fix it, and it must not stop the document's save.
 */
export function validateDocumentEdit(
  documentType: DocumentTemplateType,
  template: Pick<DocumentTemplate, "blocks" | "settings">,
  edit: DocumentEdit
): TextProblem[] {
  const printed = applyDocumentEdit(template, edit);
  return validateTemplateText({
    documentType,
    blocks: printed.blocks,
    settings: printed.settings
  }).filter(({ blockId, code, field }) => {
    if (code === "valueLocked") return true;
    const change =
      blockId === "document" ? edit.settings : edit.blocks[blockId];
    return (
      change?.text?.[field] !== undefined ||
      change?.hide?.includes(field) === true ||
      (field === "content" &&
        change !== undefined &&
        "content" in change &&
        change.content !== undefined)
    );
  });
}

/** Refused even in a preview: a figure the record does not say would print. */
export function isFigureProblem({ code }: TextProblem): boolean {
  return (
    code === "amountRemoved" ||
    code === "amountChanged" ||
    code === "valueLocked"
  );
}

/**
 * The edit a record's preview or download prints, or why it may not print. A
 * locked record prints its saved edit, whatever was posted. An open record prints
 * the draft reduced to what differs from the template, as a save would. No draft
 * prints a figure the record does not say; a download also refuses what a save would.
 */
export async function editToPrint(args: {
  documentType: DocumentEditType;
  locked: boolean;
  isDownload: boolean;
  draft:
    | (Pick<DocumentTemplate, "blocks" | "settings"> & {
        notes?: JSONContent | null;
      })
    | null;
  readSaved: () => Promise<DocumentEdit | null>;
  readTemplate: () => Promise<Pick<DocumentTemplate, "blocks" | "settings">>;
}): Promise<{ edit: DocumentEdit | null } | { refused: string }> {
  const { documentType, draft, isDownload } = args;
  if (args.locked) return { edit: await args.readSaved() };
  if (!draft) return { refused: "Invalid document" };

  const template = await args.readTemplate();
  const edit = diffDocumentEdit(documentType, template, draft);
  const problems = validateDocumentEdit(documentType, template, edit).filter(
    (problem) => isDownload || isFigureProblem(problem)
  );
  return problems.length > 0
    ? { refused: problems.map((problem) => problem.message).join("\n") }
    : { edit: { ...edit, notes: draft.notes } };
}

/**
 * An edit as read from storage, without any value it may not change. The save
 * refuses these, so one here predates a variable being locked.
 */
export function withoutLockedValues(
  documentType: DocumentTemplateType,
  edit: DocumentEdit
): DocumentEdit {
  const valueEdits = edit.settings.valueEdits;
  if (!valueEdits) return edit;
  const locked = lockedTokens(documentType);
  const allowed = (values: Record<string, string> = {}) =>
    Object.fromEntries(
      Object.entries(values).filter(([token]) => !locked.has(token))
    );
  return {
    ...edit,
    settings: {
      ...edit.settings,
      valueEdits: {
        document: allowed(valueEdits.document),
        rows: Object.fromEntries(
          Object.entries(valueEdits.rows ?? {})
            .map(([key, values]) => [key, allowed(values)] as const)
            .filter(([, values]) => Object.keys(values).length > 0)
        )
      }
    }
  };
}
