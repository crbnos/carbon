// The raw (WASM) fallback tier: renders the user's original upload through the
// SAME ModelCanvas as the artifact tiers — one renderer, one set of chrome.
// Lazy chunk: ships only when the tier is compiled in (VITE_CAD_VIEWER_USE_SERVER
// unset) and mounts, occt-import-js WASM included.

import { useMemo } from "react";
import { ModelCanvas, type ModelCanvasProps } from "../ModelCanvas";
import { loadRawModel } from "./loadRawModel";

export type RawModelCanvasProps = Omit<
  ModelCanvasProps,
  "glbUrl" | "loadObject"
> & {
  url?: string | null;
  file?: File | null;
  /** Format is detected from this (file name or storage path). */
  filename: string;
};

export function RawModelCanvas({
  url = null,
  file = null,
  filename,
  ...canvasProps
}: RawModelCanvasProps) {
  const loadObject = useMemo(
    () => () => loadRawModel({ url, file, filename }),
    [url, file, filename]
  );
  return <ModelCanvas glbUrl={null} loadObject={loadObject} {...canvasProps} />;
}
