// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type {
  CollectedValues,
  DocumentBlock,
  DocumentSettings,
  DocumentTemplateType,
  ValueEdits
} from "@carbon/documents/template";
import {
  DEFAULT_APPROVAL_HEADING,
  DEFAULT_SUMMARY_OPTIONS,
  getTextEntries,
  HEADER_TEXT_KEYS,
  interpolateString,
  type TextEntry,
  type TextKind,
  TOKEN_RE
} from "@carbon/documents/template";
import type { JSONContent } from "@carbon/react";

export const normalize = (s: string) => s.replace(/\s+/g, " ").trim();

/** The summary's tax amount, in every document that has a summary. */
const TAX_AMOUNT_KEY = "taxValue";

/** A text the template prints: who edits it (`scope`), its key, and its text. */
export interface PrintedText {
  /** A block id, or "document" for the template's own texts. */
  scope: string;
  key: string;
  /** The text as stored, `{tokens}` included. */
  text: string;
  kind: TextKind;
  /** The column or label this value belongs to. */
  of?: string;
  /** The prefix of the table row it prints once per row. */
  row?: string;
  /** What it prints on this record: one string, or one per table row. */
  printed?: string[];
  /** Nothing but a record's value, so a label beside it says more than it does. */
  onlyValue?: boolean;
  /** A paragraph of a section the template prints, rather than a catalog text. */
  isSection?: boolean;
}

/** A text the template prints: who edits it, and what it stores. */
export interface PrintedEntry {
  scope: string;
  /** The block that prints it; null for the template's own texts. */
  block: DocumentBlock | null;
  entry: TextEntry;
  stored: { text?: Record<string, string>; hidden?: string[] };
}

/**
 * Every text the template prints, in print order: the title with the header,
 * each visible block's texts in block order, then the other document texts
 * (the footer prints last). Hidden texts print nothing, so they are left out.
 */
export function printedEntries(
  documentType: DocumentTemplateType,
  blocks: DocumentBlock[],
  settings: Pick<DocumentSettings, "text" | "hidden">
): PrintedEntry[] {
  const ofTexts = (
    scope: string,
    block: PrintedEntry["block"],
    entries: readonly TextEntry[],
    stored: PrintedEntry["stored"]
  ) =>
    entries
      .filter(
        (entry) =>
          !stored.hidden?.includes(entry.key) &&
          !(entry.of && stored.hidden?.includes(entry.of))
      )
      .map((entry) => ({ scope, block, entry, stored }));

  const documentEntries = getTextEntries(documentType, "document");
  const inHeader = (entry: TextEntry) => HEADER_TEXT_KEYS.includes(entry.key);
  return [
    ...blocks
      .filter((block) => block.visible)
      .flatMap((block) => [
        ...(block.type === "header"
          ? ofTexts(
              "document",
              null,
              documentEntries.filter(inHeader),
              settings
            )
          : []),
        ...ofTexts(
          block.id,
          block,
          getTextEntries(documentType, block.type),
          block
        )
      ]),
    ...ofTexts(
      "document",
      null,
      documentEntries.filter((entry) => !inHeader(entry)),
      settings
    )
  ];
}

function paragraphsOf(content: JSONContent | undefined): string[] {
  if (!content) return [];
  const words = (node: JSONContent): string =>
    node.text ?? (node.content ?? []).map(words).join("");
  const isLeafBlock = (node: JSONContent) =>
    node.content?.some((child) => child.text !== undefined) ?? false;
  return isLeafBlock(content)
    ? [words(content)]
    : (content.content ?? []).flatMap(paragraphsOf);
}

/**
 * What a block prints from its own settings rather than a text catalog: a
 * label's fields, a rich text, a key-value list. No text in the panel stands for
 * them, so a click on one only has to select the block.
 */
function ownTexts(block: DocumentBlock): PrintedText[] {
  const value = (text: string, of?: string): PrintedText => ({
    scope: block.id,
    key: "value",
    text,
    kind: "value",
    of
  });
  const name = (text: string): PrintedText => ({
    scope: block.id,
    key: "label",
    text,
    kind: "field"
  });
  const named = (names: string[], text: string): PrintedText[] => [
    ...names.map(name),
    value(text, "label")
  ];
  const paragraphs = (content: JSONContent | undefined): PrintedText[] =>
    paragraphsOf(content).map((text) => ({
      scope: block.id,
      key: "content",
      text,
      kind: "text"
    }));

  switch (block.type) {
    case "labelHeading":
      return [value("{item.id}")];
    case "labelEntityId":
      return [value("{label.trackedEntityId}")];
    case "labelRevision":
      return named([block.label || "Rev"], "{item.revision}");
    case "labelQuantity":
      return named([block.label || "Qty"], "{label.quantity}");
    case "labelTracking":
      return named(
        block.label ? [block.label] : ["S/N", "Batch"],
        "{label.number}"
      );
    case "field":
      return block.label
        ? named([block.label], block.value ?? "")
        : [value(block.value ?? "")];
    case "keyValue":
      return block.rows.flatMap((row) => named([row.label], row.value));
    case "customField":
      return block.label ? [name(block.label)] : [];
    case "richText":
      return [
        ...(block.title ? [name(block.title)] : []),
        ...paragraphs(block.content)
      ];
    case "approval": {
      const heading = block.heading ?? DEFAULT_APPROVAL_HEADING;
      return heading ? [name(heading)] : [];
    }
    default:
      return [];
  }
}

/** Rich text sections a template prints, by what they print on. */
export interface PrintedSections {
  /** A shared block's section content, by section id. */
  content: (sectionId: string) => JSONContent | undefined;
  headerSectionId: string | null;
  footerSectionId: string | null;
}

function sectionTexts(
  scope: string,
  key: string,
  content: JSONContent | undefined
): PrintedText[] {
  return paragraphsOf(content).map((text) => ({
    scope,
    key,
    text,
    kind: "text",
    isSection: true
  }));
}

/** Every text the preview can show, in print order, with the words it prints. */
export function printedTexts(
  documentType: DocumentTemplateType,
  blocks: DocumentBlock[],
  settings: Pick<DocumentSettings, "text" | "hidden">,
  sections?: PrintedSections
): PrintedText[] {
  const catalog = printedEntries(documentType, blocks, settings).flatMap(
    ({ scope, block, entry, stored }) => {
      const text: PrintedText = {
        scope,
        key: entry.key,
        text: stored.text?.[entry.key] ?? entry.default,
        kind: entry.kind,
        of: entry.of,
        row: entry.row
      };
      // The tax row's label is the summary's own option, not a catalog text. A
      // click on it, or on its amount, goes to the amount's row.
      if (block?.type !== "summary" || entry.key !== TAX_AMOUNT_KEY) {
        return [text];
      }
      const label =
        block.options?.taxLabel?.trim() || DEFAULT_SUMMARY_OPTIONS.taxLabel;
      return [
        { ...text, kind: "text" as const, text: `${label} ({currency})` },
        text
      ];
    }
  );
  const documentTexts = catalog.filter((text) => text.scope === "document");
  const inHeader = (text: PrintedText) => HEADER_TEXT_KEYS.includes(text.key);
  const sectionOf = (id: string | null | undefined) =>
    id ? sections?.content(id) : undefined;
  return [
    ...blocks
      .filter((block) => block.visible)
      .flatMap((block) => [
        ...(block.type === "header"
          ? [
              ...documentTexts.filter(inHeader),
              ...sectionTexts(
                "document",
                "title",
                sectionOf(sections?.headerSectionId)
              )
            ]
          : []),
        ...catalog.filter((text) => text.scope === block.id),
        ...ownTexts(block),
        ...(block.type === "shared"
          ? sectionTexts(block.id, "content", sectionOf(block.sectionId))
          : [])
      ]),
    ...documentTexts.filter((text) => !inHeader(text)),
    ...sectionTexts("document", "page", sectionOf(sections?.footerSectionId))
  ];
}

/**
 * The texts with this record's values in them, so a click can tell one value
 * from another: "Globex" is the customer's name, not just a line under its
 * heading. A text whose values are all empty prints nothing and is left out, with
 * the label it belongs to, so it cannot take the place of the next text with the
 * same words. `printed` says what each text prints; a text with a variable the
 * values do not hold keeps its `{token}`.
 */
export function fillPrintedTexts(
  texts: PrintedText[],
  values: CollectedValues,
  edits?: ValueEdits
): PrintedText[] {
  const document = { ...values.document, ...edits?.document };
  const printsNothing = new Set<string>();
  const filled = texts.flatMap((text): PrintedText[] => {
    const tokens = [...text.text.matchAll(TOKEN_RE)].map((match) => match[1]);
    if (tokens.length === 0) return [{ ...text, printed: [text.text] }];

    if (text.row) {
      const printed = values.rows
        .filter((row) => row.prefix === text.row)
        .map((row) =>
          normalize(
            interpolateString(text.text, {
              ...document,
              ...row.values,
              ...edits?.rows?.[row.key]
            })
          )
        )
        .filter(Boolean);
      return [{ ...text, printed }];
    }

    const known = tokens.filter((token) => token && token in document);
    if (known.length === 0) return [text];
    if (known.length === tokens.length && known.every((t) => !document[t])) {
      if (text.of) printsNothing.add(`${text.scope}:${text.of}`);
      return [];
    }
    const words = normalize(
      text.text.replace(TOKEN_RE, (match, token: string) =>
        token in document ? (document[token] ?? "") : match
      )
    );
    return [
      {
        ...text,
        printed: [words],
        onlyValue: !text.text.replace(TOKEN_RE, "").trim()
      }
    ];
  });
  // A label prints only with its value: no "Supplier:" on an issue without one.
  return filled.filter(
    (text) => !printsNothing.has(`${text.scope}:${text.key}`)
  );
}

/**
 * What a text is called in the panel: its words before any variable ("PO
 * Number"), else the names of its variables ("Supplier Name").
 */
export function wordName(text: string, labels: Record<string, string>) {
  const first = text.search(TOKEN_RE);
  const trimmed = (first < 0 ? text : text.slice(0, first))
    .replace(/[\s:(\-–]+$/u, "")
    .trim();
  if (first < 0) return trimmed;
  const words = trimmed.replace(/^[\s\-–]+/u, "");
  // One letter before a variable ("V{revision}") names nothing.
  if (words.length > 1) return words;
  return [...text.matchAll(TOKEN_RE)]
    .map((match) => labels[match[1]] ?? match[0])
    .join(" ");
}

/**
 * The texts of a block in the boxes they print in: a heading starts a group, and
 * so does a table column with its per-row values. Texts before the first group
 * stand on their own, under no title.
 */
export function groupTexts(
  entries: readonly TextEntry[],
  labels: Record<string, string>
) {
  const groups: { id: string; title: string | null; entries: TextEntry[] }[] =
    [];
  for (const entry of entries) {
    const inColumn = groups.at(-1)?.entries.some((e) => e.row) ?? false;
    const starts =
      entry.kind === "heading" ||
      entry.kind === "column" ||
      entries.some((e) => e.row && e.of === entry.key) ||
      // A table's total prints under the table, not in its last column.
      (inColumn && !entry.row);
    if (starts || groups.length === 0) {
      groups.push({
        id: entry.key,
        title: starts ? wordName(entry.default, labels) : null,
        entries: []
      });
    }
    groups[groups.length - 1].entries.push(entry);
  }
  return groups;
}
