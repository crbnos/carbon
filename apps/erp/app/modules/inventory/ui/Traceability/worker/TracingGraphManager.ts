import * as Comlink from "comlink";
import type { LineageEdge } from "../utils";
import type { LayoutInput, LayoutResult, SelectionPathResult } from "./core";

type WorkerApi = {
  layout: (input: LayoutInput) => LayoutResult;
  selection: (
    edges: LineageEdge[],
    rootIds: string[]
  ) => SelectionPathResult | null;
};

export class TracingGraphManager {
  private worker: Worker | null = null;
  private proxy: Comlink.Remote<WorkerApi> | null = null;
  private layoutSeq = 0;
  private selectionSeq = 0;
  private disposed = false;

  init(): void {
    if (this.worker || this.disposed || typeof Worker === "undefined") return;
    this.worker = new Worker(new URL("./lineage.worker.ts", import.meta.url), {
      type: "module"
    });
    this.proxy = Comlink.wrap<WorkerApi>(this.worker);
  }

  dispose(): void {
    this.disposed = true;
    this.proxy?.[Comlink.releaseProxy]();
    this.worker?.terminate();
    this.worker = null;
    this.proxy = null;
  }

  async layout(input: LayoutInput): Promise<LayoutResult | null> {
    const seq = ++this.layoutSeq;
    if (this.proxy) {
      const result = await this.proxy.layout(input);
      if (this.disposed || seq !== this.layoutSeq) return null;
      return result;
    }
    const { computeFullLayout } = await import("./core");
    if (this.disposed || seq !== this.layoutSeq) return null;
    return computeFullLayout(input);
  }

  async selection(
    edges: LineageEdge[],
    rootIds: string[]
  ): Promise<SelectionPathResult | null> {
    const seq = ++this.selectionSeq;
    if (this.proxy) {
      const result = await this.proxy.selection(edges, rootIds);
      if (this.disposed || seq !== this.selectionSeq) return null;
      return result;
    }
    const { computeSelectionPath } = await import("./core");
    if (this.disposed || seq !== this.selectionSeq) return null;
    return computeSelectionPath(edges, rootIds);
  }
}
