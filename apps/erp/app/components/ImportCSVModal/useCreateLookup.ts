import { toast } from "@carbon/react";
import { useEffect, useRef } from "react";
import { useFetcher } from "react-router";
import type { CreatableLookup } from "~/modules/shared";
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
  const fetcher = useFetcher<typeof action>();
  const pendingCsvValuesRef = useRef<string[] | null>(null);

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

  // biome-ignore lint/correctness/useExhaustiveDependencies: respond to create result
  useEffect(() => {
    const data = fetcher.data;
    const pending = pendingCsvValuesRef.current;
    if (!data || pending === null) return;
    if ("results" in data && data.results) {
      const created: string[] = [];
      const failures: string[] = [];
      data.results.forEach((result, index) => {
        const csvValue = pending[index];
        if (result.id && csvValue !== undefined) {
          onLinked(csvValue, result.id, result.name);
          created.push(result.name);
        } else if (result.error) {
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
      pendingCsvValuesRef.current = null;
    } else if ("error" in data && data.error) {
      toast.error(data.error);
      pendingCsvValuesRef.current = null;
    }
  }, [fetcher.data]);

  return { create, isCreating: fetcher.state !== "idle" };
}
