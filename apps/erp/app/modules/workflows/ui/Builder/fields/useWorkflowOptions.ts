import type { OptionsSource } from "@carbon/workflows";
import { useEffect, useMemo } from "react";
import { useFetcher } from "react-router";
import { path } from "~/utils/path";

export type WorkflowOptions = {
  options: { label: string; value: string }[];
  emptyHref?: string;
  error?: string;
};

/**
 * Fetches one input's choices from the options endpoint.
 *
 * Shared by the field that renders a fetched list and by the integration form's
 * "is this app connected?" check, so the two can never disagree about how a
 * provider is called — in particular about `dependsOn`, which a caller that built
 * its own query string would be free to forget.
 *
 * `ready` is false while any dependency is still blank; nothing is requested until
 * every one of them holds a value.
 */
export function useWorkflowOptions(
  source: OptionsSource | undefined,
  values: Record<string, string> = {},
  fetcherKey?: string
) {
  const fetcher = useFetcher<WorkflowOptions>(
    fetcherKey === undefined ? undefined : { key: fetcherKey }
  );

  const dependsOn = useMemo(() => source?.dependsOn ?? [], [source?.dependsOn]);
  const missing = dependsOn.filter((name) => !values[name]);
  const ready = source !== undefined && missing.length === 0;

  // `values` is a fresh object every render, so the serialized payload — stable by
  // value — is what identifies the request rather than the object's identity.
  const payload = JSON.stringify(
    Object.fromEntries(dependsOn.map((name) => [name, values[name] ?? ""]))
  );

  const query = useMemo(() => {
    if (source === undefined) return undefined;
    const params = new URLSearchParams({ provider: source.provider });
    if (source.params) params.set("params", JSON.stringify(source.params));
    if (dependsOn.length > 0) params.set("values", payload);
    return params.toString();
  }, [source, dependsOn, payload]);

  useEffect(() => {
    if (!ready || query === undefined) return;
    if (fetcher.state === "idle" && fetcher.data === undefined) {
      fetcher.load(`${path.to.api.workflowOptions}?${query}`);
    }
  }, [fetcher, query, ready]);

  return {
    ready,
    missing,
    /** The request has come back, whatever it contained. */
    loaded: fetcher.data !== undefined,
    isLoading: fetcher.state === "loading",
    options: fetcher.data?.options ?? [],
    emptyHref: fetcher.data?.emptyHref,
    error: fetcher.data?.error
  };
}
