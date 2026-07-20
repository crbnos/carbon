// The raw (WASM) fallback tier: renders the user's original upload through the
// SAME ModelCanvas as the artifact tiers — one renderer, one set of chrome.
// Lazy-imported by ModelPreview only when VITE_CAD_WASM_VIEWER is on, so this
// file (and the occt-import-js WASM it pulls for STEP/IGES/BREP) never ships
// otherwise.

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
