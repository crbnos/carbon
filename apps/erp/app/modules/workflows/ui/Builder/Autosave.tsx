import { toast } from "@carbon/react";
import { useEffect, useRef } from "react";
import { useFetcher } from "react-router";
import { path } from "~/utils/path";
import { useBuilderStore, useBuilderStoreApi } from "./context";
import { fromReactFlow } from "./graph";

const DEBOUNCE_MS = 1000;

/**
 * Debounced autosave, in two modes. An editable version posts the whole definition to
 * `/save`. A LIVE version posts positions only, to `/positions` — the store lets nothing
 * else through, and `/save` would refuse it with a 409 anyway.
 */
export function Autosave({
  workflowId,
  versionId
}: {
  workflowId: string;
  versionId: string;
}) {
  const store = useBuilderStoreApi();
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const { submit } = fetcher;
  /** The snapshot of the in-flight save, or null when nothing is pending. */
  const submittedRef = useRef<string | null>(null);

  const nodes = useBuilderStore((state) => state.nodes);
  const edges = useBuilderStore((state) => state.edges);
  const canChangeDefinition = useBuilderStore(
    (state) => state.canChangeDefinition
  );
  const canMoveNodes = useBuilderStore((state) => state.canMoveNodes);

  useEffect(() => {
    if (!canChangeDefinition && !canMoveNodes) return;

    const timer = setTimeout(() => {
      const state = store.getState();
      const definition = fromReactFlow(nodes, edges);
      const submitted = JSON.stringify(definition);
      if (submitted === state.baseline) return;

      const formData = new FormData();
      formData.append("versionId", versionId);

      if (canChangeDefinition) {
        formData.append("nodes", JSON.stringify(definition.nodes));
        formData.append("edges", JSON.stringify(definition.edges));
        formData.append("formatVersion", String(definition.formatVersion));
      } else {
        // Live version: a drag is the only thing the store let through, so positions
        // are the only thing worth sending — and the only thing the server accepts.
        formData.append(
          "positions",
          JSON.stringify(
            Object.fromEntries(
              definition.nodes.map((node) => [
                node.id,
                { x: node.position.x, y: node.position.y }
              ])
            )
          )
        );
      }

      submittedRef.current = submitted;
      state.setSaveState("saving");
      submit(formData, {
        method: "post",
        action: canChangeDefinition
          ? path.to.workflowSave(workflowId)
          : path.to.workflowPositions(workflowId)
      });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
    // `fetcher` is deliberately not a dependency — its identity changes on every
    // state tick, which would restart the debounce forever.
  }, [
    nodes,
    edges,
    canChangeDefinition,
    canMoveNodes,
    store,
    versionId,
    workflowId,
    submit
  ]);

  useEffect(() => {
    const submitted = submittedRef.current;
    if (submitted === null || fetcher.state !== "idle") return;
    submittedRef.current = null;

    const state = store.getState();
    if (fetcher.data?.ok) {
      state.rebaseline(submitted);
      state.setSaveState("saved");
    } else {
      state.setSaveState("error");
      toast.error(fetcher.data?.error ?? "Could not save workflow");
    }
  }, [fetcher.data, fetcher.state, store]);

  return null;
}
