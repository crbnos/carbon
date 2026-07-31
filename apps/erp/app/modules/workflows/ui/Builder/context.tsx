import type { PropsWithChildren } from "react";
import { createContext, useContext, useRef } from "react";
import type { StoreApi } from "zustand";
import { useStore } from "zustand";
import type { BuilderEdge, BuilderNode } from "../../types";
import type { BuilderState } from "./store";
import { createBuilderStore } from "./store";

// One store per builder instance, held in a ref — the DocumentTemplateEditor idiom.
const BuilderContext = createContext<StoreApi<BuilderState> | null>(null);

export function useBuilderStore<T>(selector: (state: BuilderState) => T): T {
  const store = useContext(BuilderContext);
  if (!store) {
    throw new Error(
      "Workflow builder hooks must be used within a WorkflowBuilderProvider"
    );
  }
  return useStore(store, selector);
}

export function useBuilderStoreApi(): StoreApi<BuilderState> {
  const store = useContext(BuilderContext);
  if (!store) {
    throw new Error(
      "Workflow builder hooks must be used within a WorkflowBuilderProvider"
    );
  }
  return store;
}

type WorkflowBuilderProviderProps = {
  nodes: BuilderNode[];
  edges: BuilderEdge[];
  isReadOnly: boolean;
};

export function WorkflowBuilderProvider({
  children,
  ...props
}: PropsWithChildren<WorkflowBuilderProviderProps>) {
  const storeRef = useRef<StoreApi<BuilderState> | null>(null);
  if (!storeRef.current) storeRef.current = createBuilderStore(props);

  return (
    <BuilderContext.Provider value={storeRef.current}>
      {children}
    </BuilderContext.Provider>
  );
}
