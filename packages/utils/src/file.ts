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
// tessellates) or a glTF/GLB container. Others (stl/obj/iges/…) aren't optimised
// on upload yet. Returns the service `format` string, or null if not optimisable.
export function optimizableModelFormat(
  ext: string
): "step" | "gltf" | "glb" | null {
  switch (ext.toLowerCase()) {
    case "step":
    case "stp":
      return "step";
    case "gltf":
      return "gltf";
    case "glb":
      return "glb";
    default:
      return null;
  }
}

export const supportedModelTypes = [
  "3dm",
  "3ds",
  "3mf",
  "amf",
  "bim",
  "brep",
  "dae",
  "fbx",
  "fcstd",
  "gltf",
  "ifc",
  "iges",
  "obj",
  "off",
  "ply",
  "step",
  "stl",
  "stp"
];
