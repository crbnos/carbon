import * as Comlink from "comlink";
import { computeFullLayout, computeSelectionPath } from "./core";

const api = {
  layout: computeFullLayout,
  selection: computeSelectionPath
};

export type LineageWorkerApi = typeof api;

Comlink.expose(api);
