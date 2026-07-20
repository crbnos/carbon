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

// Mesh formats the assembler's /v1/optimize can ingest today: STEP (it
// tessellates), the compacted BinXCAF (`xbf`) retained-raw form, or a glTF/GLB
// container. Others (stl/obj/iges/…) aren't optimised on upload yet. Returns the
// service `format` string, or null if not optimisable.
export function optimizableModelFormat(
  ext: string
): "step" | "xbf" | "gltf" | "glb" | "stl" | null {
  switch (ext.toLowerCase()) {
    case "step":
    case "stp":
      return "step";
    case "xbf":
      return "xbf";
    case "gltf":
      return "gltf";
    case "glb":
      return "glb";
    case "stl":
      return "stl";
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
