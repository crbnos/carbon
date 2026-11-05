// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type {
  CollectedValues,
  DocumentBlock,
  DocumentSettings,
  DocumentTemplateType
} from "@carbon/documents/template";
import {
  allMergeFields,
  isEditableValue,
  TOKEN_RE
} from "@carbon/documents/template";
import { normalize, type PageRun, printedEntries } from "./previewText";

/** One value a document prints that the user can change. */
export interface ValueTarget {
  /** The panel that lists it: a block id, or "document". */
  scope: string;
  /** The text that prints it. */
  key: string;
  /** The table row it belongs to; null for a value of the whole document. */
  rowKey: string | null;
  prefix: string | null;
  token: string;
  recordValue: string;
  /** What the page prints now: the changed value, else the record's. */
  printedValue: string;
}

/**
 * Every value the document's current words print, in print order, without
 * amounts, quantities or anything else one document cannot change.
 */
export function valueTargets(
  documentType: DocumentTemplateType,
  blocks: DocumentBlock[],
  settings: Pick<DocumentSettings, "text" | "hidden" | "valueEdits">,
  collected: CollectedValues
): ValueTarget[] {
  const editable = new Set(
    allMergeFields(documentType)
      .filter(isEditableValue)
      .map((field) => field.token)
  );

  const seen = new Set<string>();
  return printedEntries(documentType, blocks, settings).flatMap(
    ({ scope, entry, stored }) => {
      const text = stored.text?.[entry.key] ?? entry.default;
      return [...text.matchAll(TOKEN_RE)].flatMap(
        ([, token = ""]): ValueTarget[] => {
          if (!editable.has(token)) return [];
          const isRowToken = entry.row && token.startsWith(`${entry.row}.`);
          if (!isRowToken) {
            // One chip stands for one value, however many texts print it.
            const id = `${scope}|${token}`;
            if (seen.has(id) || !(token in collected.document)) return [];
            seen.add(id);
            return [
              {
                scope,
                key: entry.key,
                rowKey: null,
                prefix: null,
                token,
                recordValue: collected.document[token] ?? "",
                printedValue:
                  settings.valueEdits?.document?.[token] ??
                  collected.document[token] ??
                  ""
              }
            ];
          }
          return collected.rows.flatMap((row) => {
            const id = `${scope}|${row.key}|${token}`;
            if (row.prefix !== entry.row || seen.has(id)) return [];
            seen.add(id);
            return [
              {
                scope,
                key: entry.key,
                rowKey: row.key,
                prefix: row.prefix,
                token,
                recordValue: row.values[token] ?? "",
                printedValue:
                  settings.valueEdits?.rows?.[row.key]?.[token] ??
                  row.values[token] ??
                  ""
              }
            ];
          });
        }
      );
    }
  );
}

/** Short values ("1", "EA") would match inside unrelated text. */
const MIN_PARTIAL_MATCH = 3;

function holdsWords(text: string, part: string) {
  const index = text.indexOf(part);
  if (index === -1) return false;
  const before = text[index - 1];
  const after = text[index + part.length];
  const isWordChar = (c?: string) => !!c && /[\p{L}\p{N}]/u.test(c);
  return !isWordChar(before) && !isWordChar(after);
}

/**
 * The value a click on the preview points at. The run is the value, ends with it
 * after a label ("Contact: Sam"), or is a piece of it (a wrapped or split line).
 * When rows repeat the same text, the n-th such run on the page is the n-th row.
 * Null means no changeable value printed here, so the caller falls back to the
 * words that printed it.
 */
export function findPrintedValue(
  lines: PageRun[][],
  clicked: { line: number; run: number },
  targets: ValueTarget[],
  /** Texts with no variables: a run that equals one is that word, not a value. */
  words: readonly string[] = []
): ValueTarget | null {
  const text = normalize(lines[clicked.line]?.[clicked.run]?.text ?? "");
  if (!text) return null;

  const candidates = targets
    .map((target) => ({ target, value: normalize(target.printedValue) }))
    .filter(({ value }) => value);

  const exact = candidates.filter(({ value }) => value === text);
  if (exact.length > 0) {
    let earlier = 0;
    for (let i = 0; i <= clicked.line; i++) {
      const runs = lines[i] ?? [];
      const end = i === clicked.line ? clicked.run : runs.length;
      for (let r = 0; r < end; r++) {
        if (normalize(runs[r]?.text ?? "") === text) earlier++;
      }
    }
    return exact[earlier % exact.length]?.target ?? null;
  }

  const afterLabel = candidates
    .filter(
      ({ value }) =>
        value.length >= MIN_PARTIAL_MATCH &&
        text.endsWith(value) &&
        holdsWords(text, value)
    )
    .sort((a, b) => b.value.length - a.value.length);
  if (afterLabel[0]) return afterLabel[0].target;

  if (text.length < MIN_PARTIAL_MATCH) return null;
  const isWord = words.some(
    (word) => normalize(word).toLowerCase() === text.toLowerCase()
  );
  if (isWord) return null;
  return (
    candidates.find(({ value }) => holdsWords(value, text))?.target ?? null
  );
}
