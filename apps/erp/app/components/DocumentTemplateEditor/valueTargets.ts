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
import { printedEntries } from "./previewText";

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
