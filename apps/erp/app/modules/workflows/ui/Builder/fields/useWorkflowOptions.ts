import type { OptionsSource } from "@carbon/workflows";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useFetcher } from "react-router";
import type { OptionsErrorCode } from "~/modules/workflows/options-providers.server";
import { path } from "~/utils/path";

export type WorkflowOptions = {
  options: { label: string; value: string }[];
  emptyHref?: string;
  errorCode?: OptionsErrorCode;
  /** Where the author can go to fix what the error describes. */
  errorHref?: string;
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

  // Keyed on the QUERY, not on `fetcher.data` being undefined. The latter is only
  // true before the first response, so a field never refetched when a dependency
  // changed — and a first load that FAILED left `data` set to `{options: []}`,
  // pinning the field empty for the rest of the editing session with no way back.
  const loadedQuery = useRef<string | undefined>(undefined);

  // What the field SHOULD be showing, which is not always what is in flight: a
  // dependency that changes twice while a request is out would otherwise leave the
  // last query unissued, pinning the field on the previous dependency's choices.
  const wantedQuery = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!ready || query === undefined) return;
    wantedQuery.current = query;
    if (fetcher.state !== "idle") return;
    if (loadedQuery.current === query) return;
    loadedQuery.current = query;
    fetcher.load(`${path.to.api.workflowOptions}?${query}`);
  }, [fetcher, query, ready]);

  // The in-flight request has landed; issue the one the author has since asked for.
  useEffect(() => {
    if (fetcher.state !== "idle") return;
    const wanted = wantedQuery.current;
    if (wanted === undefined || loadedQuery.current === wanted) return;
    loadedQuery.current = wanted;
    fetcher.load(`${path.to.api.workflowOptions}?${wanted}`);
  }, [fetcher]);

  /** Re-request the same query after a failure. */
  const retry = useCallback(() => {
    if (!ready || query === undefined) return;
    loadedQuery.current = query;
    fetcher.load(`${path.to.api.workflowOptions}?${query}`);
  }, [fetcher, query, ready]);

  return {
    ready,
    missing,
    /** The request has come back, whatever it contained. */
    loaded: fetcher.data !== undefined,
    isLoading: fetcher.state === "loading",
    options: fetcher.data?.options ?? [],
    emptyHref: fetcher.data?.emptyHref,
    errorCode: fetcher.data?.errorCode,
    errorHref: fetcher.data?.errorHref,
    retry
  };
}
