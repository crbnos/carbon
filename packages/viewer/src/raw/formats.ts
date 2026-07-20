// Raw-tier format detection. Deliberately dependency-free: ModelPreview imports
// this eagerly to decide whether the (lazy) WASM tier is worth mounting, without
// pulling three/occt into the eager bundle.

export const OCCT_EXTS = ["step", "stp", "iges", "igs", "brep", "brp"];
export const RAW_RENDERABLE_EXTS = ["glb", "gltf", "stl", ...OCCT_EXTS];

export function rawExtension(filename: string): string {
  const base = filename.split("?")[0] ?? "";
  return base.split(".").pop()?.toLowerCase() ?? "";
}

export function isRawRenderable(filename: string): boolean {
  return RAW_RENDERABLE_EXTS.includes(rawExtension(filename));
}
