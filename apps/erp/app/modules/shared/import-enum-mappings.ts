// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Enum mappings for a CSV import run without the import wizard (MCP), built
// with the wizard's own matchers. Kept out of imports.models.ts so the MCP
// manifest's inputs stay the models and what they import.

import {
  buildOptionLookup,
  type MatchableOption,
  matchCsvValue,
  toMatchableOption
} from "~/components/ImportCSVModal/enumMatch";
import type { ListItem } from "~/types";
import { enumDefault, fieldMappings } from "./imports.models";
import type { CsvImportTable } from "./shared.models";

/**
 * A fetched lookup row as an import option. It matches by the same keys as in
 * the wizard, and by its id, which `getCsvImportFields` lists as the option.
 */
export function fetchedImportOption(item: ListItem): MatchableOption {
  const option = toMatchableOption(item, false);
  return { ...option, aliases: [...(option.aliases ?? []), item.id] };
}

/**
 * The enum mappings the import wizard would send, for an import with no
 * wizard (MCP). Like `FieldMappings`, every enum field starts from its default
 * and each CSV value is matched to an option by label or alias; `given`
 * mappings win. A value that matches nothing is returned in `unmatched`
 * instead of taking the default: no one reviews the mapping here. A default
 * that is not one of the field's own options is left out, so the importer
 * never receives a value it rejects.
 */
export function enumMappingsForCsv(
  table: CsvImportTable,
  rows: Record<string, string>[],
  columnMappings: Record<string, string>,
  optionsByField: Record<string, MatchableOption[]>,
  given: Record<string, Record<string, string>> = {}
) {
  const fields = fieldMappings[table] as Record<
    string,
    {
      type: string;
      enumData?: { options?: readonly string[]; default?: string };
    }
  >;
  const enumMappings: Record<string, Record<string, string>> = {};
  const unmatched: Record<string, string[]> = {};

  for (const [key, field] of Object.entries(fields)) {
    if (field.type !== "enum") continue;
    const mapping: Record<string, string> = {};
    const fallback = enumDefault(field.enumData);
    if (fallback) mapping.Default = fallback;
    Object.assign(mapping, given[key]);

    const column = columnMappings[key];
    if (column) {
      const lookup = buildOptionLookup(
        optionsByField[key] ??
          (field.enumData?.options ?? []).map((option) => ({
            label: option,
            value: option
          }))
      );
      const values = new Set(
        rows.map((row) => row[column]?.trim() ?? "").filter(Boolean)
      );
      for (const value of values) {
        if (value in mapping) continue;
        const matched = matchCsvValue(lookup, value);
        if (matched) {
          mapping[value] = matched;
        } else {
          (unmatched[key] ??= []).push(value);
        }
      }
    }
    enumMappings[key] = mapping;
  }

  return { enumMappings, unmatched };
}

/**
 * Enum fields whose options are records an earlier import may have created
 * with a CSV Unique ID (`externalIntegrationMapping`, integration "csv"), and
 * the entity type those ids are stored under.
 */
export const CSV_ID_ENTITY_TYPES: Partial<Record<string, string>> = {
  supplierId: "supplier"
};

/**
 * Resolve values the option match left unmatched by the CSV Unique ID an
 * earlier import gave the record. `matches` holds, per field, the stored
 * Unique ID → record id pairs for those values. It runs after the name and
 * readable id match, so a Unique ID that equals another record's name changes
 * nothing, and a pair whose record is not one of the field's options (a
 * deleted record) is ignored. Returns the mappings and what is still
 * unmatched.
 */
export function withCsvIdMatches(
  enumMappings: Record<string, Record<string, string>>,
  unmatched: Record<string, string[]>,
  matches: Record<string, Map<string, string>>,
  optionsByField: Record<string, MatchableOption[]>
) {
  const mappings = { ...enumMappings };
  const stillUnmatched: Record<string, string[]> = {};
  for (const [key, values] of Object.entries(unmatched)) {
    const optionValues = new Set(
      (optionsByField[key] ?? []).map((option) => option.value)
    );
    const left: string[] = [];
    for (const value of values) {
      const recordId = matches[key]?.get(value);
      if (recordId && optionValues.has(recordId)) {
        mappings[key] = { ...mappings[key], [value]: recordId };
      } else {
        left.push(value);
      }
    }
    if (left.length > 0) stillUnmatched[key] = left;
  }
  return { enumMappings: mappings, unmatched: stillUnmatched };
}
