import { describe, expect, it } from "vitest";
import type { BuilderNode } from "../../types";
import { createNode } from "./graph";
import { createBuilderStore, snapshot } from "./store";

const store = () =>
  createBuilderStore({
    nodes: [createNode("trigger", { x: 0, y: 0 })] as unknown as BuilderNode[],
    edges: [],
    isReadOnly: false,
    isOwner: true
  });

describe("rebaseline", () => {
  it("keeps edits made while a save was in flight dirty", () => {
    const api = store();

    // Edit A, then the autosave submits its snapshot.
    api.getState().addNode("action", { x: 0, y: 260 });
    const submitted = snapshot(api.getState().nodes, api.getState().edges);

    // Edit B lands before A's response comes back.
    api.getState().addNode("action", { x: 0, y: 520 });
    const current = snapshot(api.getState().nodes, api.getState().edges);

    api.getState().rebaseline(submitted);

    expect(api.getState().baseline).toBe(submitted);
    expect(api.getState().baseline).not.toBe(current);
  });

  it("marks the graph clean when nothing changed during the save", () => {
    const api = store();

    api.getState().addNode("action", { x: 0, y: 260 });
    const submitted = snapshot(api.getState().nodes, api.getState().edges);
    api.getState().rebaseline(submitted);

    expect(api.getState().baseline).toBe(
      snapshot(api.getState().nodes, api.getState().edges)
    );
  });
});
