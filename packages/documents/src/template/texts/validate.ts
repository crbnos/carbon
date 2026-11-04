// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { JSONContent } from "@carbon/react";
import { BLOCK_META } from "../defaults";
import { getMergeFields, TOKEN_RE } from "../merge";
import type { DocumentBlock, DocumentTemplate } from "../schema";
import { getTextEntries, isHideable } from "./index";

export interface TextProblem {
  /** The block id, or "document" for the template's own texts. */
  blockId: string;
  /** The catalog key, or the block field that holds the text ("content", "label"…). */
  field: string;
  /** Why it is refused; the editor words it from this, translated. */
  code: "unknownVariable" | "unknownText" | "notHideable";
  /** The unknown variable, for `unknownVariable`. */
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

/**
 * Every reason a template cannot be saved because of its texts: a text key or
 * a hidden key the catalog does not have, or a `{variable}` the document type
 * does not offer. Empty means the texts are fine.
 */
export function validateTemplateText(
  template: Pick<DocumentTemplate, "documentType" | "blocks" | "settings">
): TextProblem[] {
  const { documentType } = template;
  const known = new Set(getMergeFields(documentType).map((f) => f.token));
  const problems: TextProblem[] = [];

  const checkVariables = (
    blockId: string,
    where: string,
    field: string,
    text: string
  ) => {
    for (const token of tokensIn(text)) {
      if (!known.has(token)) {
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

  for (const block of template.blocks) {
    const label = BLOCK_META[block.type]?.label ?? block.type;
    const entries = getTextEntries(documentType, block.type);
    const byKey = new Map(entries.map((entry) => [entry.key, entry]));

    for (const [key, value] of Object.entries(block.text ?? {})) {
      const entry = byKey.get(key);
      if (!entry) {
        problems.push({
          blockId: block.id,
          field: key,
          code: "unknownText",
          message: `${label} › ${key}: unknown text`
        });
        continue;
      }
      checkVariables(block.id, `${label} › ${entry.default}`, key, value);
    }

    for (const key of block.hidden ?? []) {
      const entry = byKey.get(key);
      if (!entry || !isHideable(entry)) {
        problems.push({
          blockId: block.id,
          field: key,
          code: "notHideable",
          message: `${label} › ${entry?.default ?? key}: cannot be hidden`
        });
      }
    }

    for (const authored of authoredTexts(block)) {
      checkVariables(
        block.id,
        `${label} › ${authored.name}`,
        authored.field,
        authored.text
      );
    }
  }

  const documentEntries = new Map(
    getTextEntries(documentType, "document").map((entry) => [entry.key, entry])
  );
  for (const [key, value] of Object.entries(template.settings?.text ?? {})) {
    const entry = documentEntries.get(key);
    if (!entry) {
      problems.push({
        blockId: "document",
        field: key,
        code: "unknownText",
        message: `Document › ${key}: unknown text`
      });
      continue;
    }
    checkVariables("document", `Document › ${entry.default}`, key, value);
  }

  for (const key of template.settings?.hidden ?? []) {
    const entry = documentEntries.get(key);
    if (!entry || !isHideable(entry)) {
      problems.push({
        blockId: "document",
        field: key,
        code: "notHideable",
        message: `Document › ${entry?.default ?? key}: cannot be hidden`
      });
    }
  }

  return problems;
}
