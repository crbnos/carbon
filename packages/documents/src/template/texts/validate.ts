// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { JSONContent } from "@carbon/react";
import { BLOCK_META } from "../defaults";
import { TOKEN_RE } from "../merge";
import {
  allMergeFields,
  getLineMergeFields,
  getMergeFields,
  lockedTokens
} from "../mergeFields";
import type { DocumentBlock, DocumentTemplate } from "../schema";
import { getTextEntries, isHideable } from "./index";
import type { TextEntry } from "./types";

export interface TextProblem {
  /** The block id, or "document" for the template's own texts. */
  blockId: string;
  /** The catalog key, or the block field that holds the text ("content", "label"…). */
  field: string;
  /** Why it is refused; the editor words it from this, translated. */
  code:
    | "unknownVariable"
    | "unknownText"
    | "notHideable"
    | "amountRemoved"
    | "amountChanged"
    | "valueLocked";
  /** The variable at fault, for every code but the text ones. */
  token?: string;
  /** The same problem in English, for API and MCP callers. */
  message: string;
}

/** One authored text that can hold variables, with the name to report it by. */
interface AuthoredText {
  field: string;
  name: string;
  text: string;
}

function tokensIn(text: string): string[] {
  return [...text.matchAll(TOKEN_RE)].map((match) => match[1] ?? "");
}

/** The `{variables}` in `text` that `known` does not offer. */
export function unknownVariables(
  text: string,
  known: Iterable<string>
): string[] {
  const offered = new Set(known);
  return tokensIn(text).filter((token) => !offered.has(token));
}

/** Every text node of a rich-text document, joined. */
function textsIn(content: JSONContent | undefined): string {
  if (!content) return "";
  const own = typeof content.text === "string" ? content.text : "";
  const children = Array.isArray(content.content)
    ? content.content.map(textsIn).join(" ")
    : "";
  return `${own} ${children}`;
}

/** The texts a block's own fields hold, outside the `text` map. */
function authoredTexts(block: DocumentBlock): AuthoredText[] {
  switch (block.type) {
    case "richText":
      return [
        { field: "title", name: "Heading", text: block.title ?? "" },
        { field: "content", name: "Content", text: textsIn(block.content) }
      ];
    case "keyValue":
      return block.rows.flatMap((row, index) => [
        { field: `rows.${index}.label`, name: "Label", text: row.label },
        { field: `rows.${index}.value`, name: "Value", text: row.value }
      ]);
    case "field":
      return [
        { field: "label", name: "Label", text: block.label ?? "" },
        { field: "value", name: "Value", text: block.value }
      ];
    case "terms":
      return [
        { field: "content", name: "Content", text: textsIn(block.content) }
      ];
    case "approval":
      return [
        { field: "heading", name: "Heading", text: block.heading ?? "" },
        { field: "content", name: "Caption", text: textsIn(block.content) }
      ];
    case "summary":
      return [
        {
          field: "taxLabel",
          name: "Tax label",
          text: block.options?.taxLabel ?? ""
        }
      ];
    case "customField":
    case "labelRevision":
    case "labelQuantity":
    case "labelTracking":
      return [{ field: "label", name: "Label", text: block.label ?? "" }];
    case "labelEntityId":
    case "labelBarcode":
      return [{ field: "value", name: "Value", text: block.value }];
    default:
      return [];
  }
}

/** What a number and a figure can be apart by and still read as one: "1 5", "1.5". */
const BETWEEN = String.raw`[\s\p{Cf}.,'’/:()\-]*`;
const NUMBER_BEFORE_FIGURE = new RegExp(`\\p{N}${BETWEEN}$`, "u");
const NUMBER_AFTER_FIGURE = new RegExp(`^${BETWEEN}\\p{N}`, "u");
/**
 * The same for a variable that prints a number, written `#` here. Two of them can
 * mean to be apart: "{shipped} / {ordered}".
 */
const VARIABLE_BEFORE_FIGURE = /#[\s\p{Cf}.,'’]*$/u;
const VARIABLE_AFTER_FIGURE = /^[\s\p{Cf}.,'’]*#/u;
/** A sign or a scale touching a figure says another figure: -5, (5), 5k. */
const SIGN_BEFORE_FIGURE = /[-−–—(]\p{Cf}*$/u;
const SCALE_AFTER_FIGURE = /^\p{Cf}*[kKmMbB](?![\p{L}\p{N}])/u;

/**
 * Every reason a template cannot be saved because of its texts: a text key or
 * a hidden key the catalog does not have, a `{variable}` the document type does
 * not offer, or a figure taken out of the text that prints it. Hiding a figure's
 * column stays allowed: the page then shows no figure rather than a wrong one.
 * Empty means the texts are fine.
 */
export function validateTemplateText(
  template: Pick<DocumentTemplate, "documentType" | "blocks" | "settings">
): TextProblem[] {
  const { documentType } = template;
  const known = new Set(getMergeFields(documentType).map((f) => f.token));
  const amounts = new Set(
    allMergeFields(documentType)
      .filter((field) => field.amount)
      .map((field) => field.token)
  );
  // A figure, or a value the document cannot change that prints a number. A unit
  // and a currency print words.
  const numbers = new Set(
    allMergeFields(documentType)
      .filter(
        (field) =>
          field.amount ||
          (field.fixed && !/\.(unit|currency)$/.test(field.token))
      )
      .map((field) => field.token)
  );
  const rowTokens = (row: string | undefined) =>
    row ? getLineMergeFields(documentType, row).map((f) => f.token) : [];
  const problems: TextProblem[] = [];

  const checkFiguresStay = (
    blockId: string,
    label: string,
    entry: TextEntry,
    value: string
  ) => {
    for (const token of tokensIn(entry.default)) {
      if (amounts.has(token) && !tokensIn(value).includes(token)) {
        problems.push({
          blockId,
          field: entry.key,
          code: "amountRemoved",
          token,
          message: `${label} › ${entry.default}: the figure {${token}} must stay`
        });
      }
    }
  };

  const checkFiguresApart = (
    blockId: string,
    where: string,
    field: string,
    value: string
  ) => {
    // Words around a figure are fine, but `1{line.quantity}` prints 15 for 5, and
    // `{line.number} {line.quantity}` prints "1 5". What a variable next to it
    // prints counts: a number if it holds one, else nothing, so that a blank
    // variable cannot stand between a typed number and the figure.
    const asPrinted = (text: string) =>
      text.replace(TOKEN_RE, (_, token: string) =>
        numbers.has(token) ? "#" : ""
      );
    for (const match of value.matchAll(TOKEN_RE)) {
      const token = match[1] ?? "";
      const before = asPrinted(value.slice(0, match.index));
      const after = asPrinted(value.slice(match.index + match[0].length));
      if (
        amounts.has(token) &&
        (NUMBER_BEFORE_FIGURE.test(before) ||
          NUMBER_AFTER_FIGURE.test(after) ||
          VARIABLE_BEFORE_FIGURE.test(before) ||
          VARIABLE_AFTER_FIGURE.test(after) ||
          SIGN_BEFORE_FIGURE.test(before) ||
          SCALE_AFTER_FIGURE.test(after))
      ) {
        problems.push({
          blockId,
          field,
          code: "amountChanged",
          token,
          message: `${where}: a number or sign cannot sit next to the figure {${token}}`
        });
      }
    }
  };

  const checkVariables = (
    blockId: string,
    where: string,
    field: string,
    text: string,
    row?: string
  ) => {
    for (const token of tokensIn(text)) {
      if (!known.has(token) && !rowTokens(row).includes(token)) {
        problems.push({
          blockId,
          field,
          code: "unknownVariable",
          token,
          message: `${where}: unknown variable {${token}}`
        });
      }
    }
  };

  /** A block's or the document's own changed words and hidden list. */
  const checkStored = (
    blockId: string,
    label: string,
    entries: readonly TextEntry[],
    stored: { text?: Record<string, string>; hidden?: string[] }
  ) => {
    const byKey = new Map(entries.map((entry) => [entry.key, entry]));
    for (const [key, value] of Object.entries(stored.text ?? {})) {
      const entry = byKey.get(key);
      if (!entry) {
        problems.push({
          blockId,
          field: key,
          code: "unknownText",
          message: `${label} › ${key}: unknown text`
        });
        continue;
      }
      checkVariables(
        blockId,
        `${label} › ${entry.default}`,
        key,
        value,
        entry.row
      );
      checkFiguresStay(blockId, label, entry, value);
      checkFiguresApart(blockId, `${label} › ${entry.default}`, key, value);
    }
    for (const key of stored.hidden ?? []) {
      const entry = byKey.get(key);
      if (!entry || !isHideable(entry)) {
        problems.push({
          blockId,
          field: key,
          code: "notHideable",
          message: `${label} › ${entry?.default ?? key}: cannot be hidden`
        });
      }
    }
  };

  for (const block of template.blocks) {
    const label = BLOCK_META[block.type]?.label ?? block.type;
    checkStored(
      block.id,
      label,
      getTextEntries(documentType, block.type),
      block
    );
    for (const authored of authoredTexts(block)) {
      checkVariables(
        block.id,
        `${label} › ${authored.name}`,
        authored.field,
        authored.text
      );
      checkFiguresApart(
        block.id,
        `${label} › ${authored.name}`,
        authored.field,
        authored.text
      );
    }
  }

  checkStored(
    "document",
    "Document",
    getTextEntries(documentType, "document"),
    template.settings ?? {}
  );

  const valueEdits = template.settings?.valueEdits;
  const changedTokens = [
    ...Object.keys(valueEdits?.document ?? {}),
    ...Object.values(valueEdits?.rows ?? {}).flatMap(Object.keys)
  ];
  for (const token of lockedTokens(documentType)) {
    if (changedTokens.includes(token)) {
      problems.push({
        blockId: "document",
        field: token,
        code: "valueLocked",
        token,
        message: `Document › {${token}}: this value cannot be changed`
      });
    }
  }

  return problems;
}
