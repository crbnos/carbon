// Raw-tier format detection. Deliberately dependency-free: ModelPreview imports
// this eagerly to decide whether the (lazy) WASM tier is worth mounting, without
// pulling three/occt into the eager bundle.

export const OCCT_EXTS = ["step", "stp", "iges", "igs", "brep", "brp"];
/** Mesh formats three-stdlib loads directly (no WASM). */
export const MESH_EXTS = [
  "glb",
  "gltf",
  "stl",
  "obj",
  "ply",
  "dae",
  "fbx",
  "3ds",
  "3mf",
  "amf",
  "off",
  // dotbim: plain JSON meshes, hand-parsed.
  "bim"
];
/** Rhino .3dm via the official rhino3dm WASM (lazy, ~4MB, only for .3dm). */
export const RHINO_EXTS = ["3dm"];
export const RAW_RENDERABLE_EXTS = [...MESH_EXTS, ...RHINO_EXTS, ...OCCT_EXTS];

export function rawExtension(filename: string): string {
  const base = filename.split("?")[0] ?? "";
  return base.split(".").pop()?.toLowerCase() ?? "";
}

export function isRawRenderable(filename: string): boolean {
  return RAW_RENDERABLE_EXTS.includes(rawExtension(filename));
}
