export const convertKbToString = (kb: number) => {
  if (kb < 1024) {
    return `${kb} KB`;
  }
  const mb = kb / 1024;
  if (mb < 1024) {
    return `${mb.toFixed(2)} MB`;
  }
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
};

// Formats the assembler's /v1/optimize can ingest: exact B-rep sources OCCT
// tessellates (step/iges/brep + the compacted BinXCAF `xbf` retained-raw form)
// and mesh sources it parses directly (glb/gltf/stl/obj/ply/off/bim/3mf/amf).
// Widen this in lockstep with the assembler's format registry — each addition
// makes that format optimise on upload (GLB-always doctrine); the remaining mesh
// formats (fbx/dae/3ds/3dm) render via the viewer's WASM raw tier only. Returns
// the service `format` string, or null if not optimisable.
export function optimizableModelFormat(
  ext: string
):
  | "step"
  | "iges"
  | "brep"
  | "xbf"
  | "gltf"
  | "glb"
  | "stl"
  | "obj"
  | "ply"
  | "off"
  | "bim"
  | "3mf"
  | "amf"
  | null {
  switch (ext.toLowerCase()) {
    case "step":
    case "stp":
      return "step";
    case "iges":
    case "igs":
      return "iges";
    case "brep":
    case "brp":
      return "brep";
    case "xbf":
      return "xbf";
    case "gltf":
      return "gltf";
    case "glb":
      return "glb";
    case "stl":
      return "stl";
    case "obj":
      return "obj";
    case "ply":
      return "ply";
    case "off":
      return "off";
    case "bim":
      return "bim";
    case "3mf":
      return "3mf";
    case "amf":
      return "amf";
    default:
      return null;
  }
}

// Resolve the assembler source format from a stored modelPath, transparently
// stripping a `.zst` compaction suffix — the retained raw may have been compacted
// to `raw.xbf.zst` / `raw.gltf.zst`, which the assembler decompresses on read.
export function modelPathOptimizeFormat(modelPath: string) {
  const lower = modelPath.toLowerCase();
  const base = lower.endsWith(".zst") ? lower.slice(0, -4) : lower;
  const ext = base.split(".").pop() ?? "";
  return optimizableModelFormat(ext);
}

// Whether the retained raw is worth offering as a download. STEP raws are
// compacted to OCCT BinXCAF (`{id}.xbf.zst`) — an OCCT-internal container no
// CAD tool opens, so downloading it would hand the user garbage bytes under the
// original `.step` filename. Mesh raws stay zstd'd in their original format and
// decompress back to the openable source file.
export function isModelRawDownloadable(modelPath: string | null | undefined) {
  if (!modelPath) return false;
  const lower = modelPath.toLowerCase();
  const base = lower.endsWith(".zst") ? lower.slice(0, -4) : lower;
  return !base.endsWith(".xbf");
}

// Every format here is renderable in the browser (viewer raw tier: three-stdlib
// loaders + occt/rhino3dm WASM). ifc and fcstd were dropped 2026-07-18: nothing
// in the stack can preview them (each needs its own heavy WASM dep) and both
// export STEP natively — accepting them just produced a dead upload. glb added
// (was oddly absent while gltf/stl were accepted and the optimiser supports it).
export const supportedModelTypes = [
  "3dm",
  "3ds",
  "3mf",
  "amf",
  "bim",
  "brep",
  "dae",
  "fbx",
  "glb",
  "gltf",
  "iges",
  "obj",
  "off",
  "ply",
  "step",
  "stl",
  "stp"
];
