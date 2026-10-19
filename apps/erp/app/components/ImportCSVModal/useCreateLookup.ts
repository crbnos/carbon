// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useAction } from "@carbon/query";
import { toast } from "@carbon/react";
import { useRef } from "react";
import type { CreatableLookup } from "~/modules/shared/imports.models";
import type { action } from "~/routes/api+/csv+/create-lookup";
import { path } from "~/utils/path";

// Submits create-lookup batches and reports each created/existing id back via
// `onLinked`. `csvValues[i]` pairs with `names[i]` — they differ for the inline
// combobox create, where the user can type a corrected name for a CSV cell
// (e.g. CSV "Raw Matl" -> create "Raw Material").
export function useCreateLookup({
  lookup,
  onLinked
}: {
  lookup: CreatableLookup | undefined;
  onLinked: (csvValue: string, id: string, label: string) => void;
}) {
  const pendingCsvValuesRef = useRef<string[] | null>(null);
  // A refused batch is toasted by `useAction`.
  const fetcher = useAction<typeof action>({
    onSettled: (data) => {
      const pending = pendingCsvValuesRef.current;
      pendingCsvValuesRef.current = null;
      const results = data && "data" in data ? data.data?.results : undefined;
      if (!results || pending === null) return;

      const created: string[] = [];
      const failures: string[] = [];
      results.forEach((result, index) => {
        const csvValue = pending[index];
        if ("id" in result && result.id && csvValue !== undefined) {
          onLinked(csvValue, result.id, result.name);
          created.push(result.name);
        } else if ("error" in result) {
          failures.push(result.name);
        }
      });
      if (created.length === 1) {
        toast.success(`Created "${created[0]}"`);
      } else if (created.length > 1) {
        toast.success(`Created ${created.length} values`);
      }
      if (failures.length > 0) {
        toast.error(`Could not create: ${failures.join(", ")}`);
      }
    }
  });

  const create = (csvValues: string[], names: string[]) => {
    if (!lookup || names.length === 0) return;
    pendingCsvValuesRef.current = csvValues;
    fetcher.submit(
      { lookup, names },
      {
        method: "POST",
        action: path.to.api.createCsvLookup,
        encType: "application/json"
      }
    );
  };

  return { create, isCreating: fetcher.isPending };
}
