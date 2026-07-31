import { useEffect, useRef } from "react";
import { useFetcher } from "react-router";
import { path } from "~/utils/path";
import { useBuilderStore, useBuilderStoreApi } from "./context";
import { fromReactFlow } from "./graph";

const DEBOUNCE_MS = 1000;

/** Debounced autosave. Safe because the version being edited is never the live one. */
export function Autosave({
  workflowId,
  versionId
}: {
  workflowId: string;
  versionId: string;
}) {
  const store = useBuilderStoreApi();
  const fetcher = useFetcher<{ ok?: boolean }>();
  const { submit } = fetcher;
  const savedRef = useRef(false);

  const nodes = useBuilderStore((state) => state.nodes);
  const edges = useBuilderStore((state) => state.edges);
  const isReadOnly = useBuilderStore((state) => state.isReadOnly);

  useEffect(() => {
    if (isReadOnly) return;

    const timer = setTimeout(() => {
      const state = store.getState();
      const definition = fromReactFlow(nodes, edges);
      if (JSON.stringify(definition) === state.baseline) return;

      const formData = new FormData();
      formData.append("versionId", versionId);
      formData.append("nodes", JSON.stringify(definition.nodes));
      formData.append("edges", JSON.stringify(definition.edges));
      formData.append("formatVersion", String(definition.formatVersion));

      savedRef.current = true;
      state.setSaveState("saving");
      submit(formData, {
        method: "post",
        action: path.to.workflowSave(workflowId)
      });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
    // `fetcher` is deliberately not a dependency — its identity changes on every
    // state tick, which would restart the debounce forever.
  }, [nodes, edges, isReadOnly, store, versionId, workflowId, submit]);

  useEffect(() => {
    if (!savedRef.current || fetcher.state !== "idle") return;
    savedRef.current = false;

    const state = store.getState();
    if (fetcher.data?.ok) {
      state.rebaseline();
      state.setSaveState("saved");
    } else {
      state.setSaveState("error");
    }
  }, [fetcher.data, fetcher.state, store]);

  return null;
}
