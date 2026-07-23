// The raw (WASM) fallback tier: renders the user's original upload through the
// SAME ModelCanvas as the artifact tiers — one renderer, one set of chrome.
// Lazy chunk: its occt-import-js WASM only downloads when this tier actually
// mounts (i.e. a model with no server artifact yet).

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
