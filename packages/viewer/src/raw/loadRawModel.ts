// In-browser raw-model loading for the WASM fallback tier: turns the user's
// original upload (GLB/glTF/STL directly; STEP/IGES/BREP via the occt-import-js
// WASM tessellator) into a THREE Object3D for the existing ModelCanvas. Lives in
// its own lazily-imported chunk — nothing here loads unless the tier renders.

// occt-import-js ships no types; the reference makes our declaration travel with
// this file into every consuming app's program (erp compiles package source).
/// <reference path="./occt-import-js.d.ts" />

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  type Object3D
} from "three";

export type RawSource = {
  /** Same-origin URL of the raw file (the auth-proxied /file/preview route). */
  url?: string | null;
  /** A just-dropped local File — renders before the upload even finishes. */
  file?: File | null;
  /** Name the format is detected from (file name or storage path). */
  filename: string;
};

import { RAW_RENDERABLE_EXTS, rawExtension } from "./formats";

export async function loadRawModel(source: RawSource): Promise<Object3D> {
  const ext = rawExtension(source.filename);
  if (!RAW_RENDERABLE_EXTS.includes(ext)) {
    throw new Error(`unsupported raw model format: ${ext || "unknown"}`);
  }
  if (ext === "glb" || ext === "gltf") return loadGltf(source);
  const bytes = await readBytes(source);
  if (ext === "stl") return loadStl(bytes);
  return loadOcct(bytes, ext);
}

async function readBytes(source: RawSource): Promise<ArrayBuffer> {
  if (source.file) return source.file.arrayBuffer();
  if (!source.url) throw new Error("raw model source has no url or file");
  // Same-origin route; cookies ride along for the auth check.
  const res = await fetch(source.url);
  if (!res.ok) throw new Error(`raw model fetch failed: ${res.status}`);
  return res.arrayBuffer();
}

async function loadGltf(source: RawSource): Promise<Object3D> {
  const { GLTFLoader } = await import("three-stdlib");
  const loader = new GLTFLoader();
  if (source.file) {
    const buffer = await source.file.arrayBuffer();
    const gltf = await loader.parseAsync(buffer, "");
    return gltf.scene;
  }
  const gltf = await loader.loadAsync(source.url!);
  return gltf.scene;
}

async function loadStl(bytes: ArrayBuffer): Promise<Object3D> {
  const { STLLoader } = await import("three-stdlib");
  const geometry = new STLLoader().parse(bytes);
  if (!geometry.attributes.normal) geometry.computeVertexNormals();
  return new Mesh(geometry, defaultMaterial());
}

/** STEP/IGES/BREP → meshes via the occt-import-js WASM build (OCCT compiled to
 *  WebAssembly — the same kernel the assembler uses server-side). */
async function loadOcct(bytes: ArrayBuffer, ext: string): Promise<Object3D> {
  const [{ default: occtimportjs }, { default: wasmUrl }] = await Promise.all([
    import("occt-import-js"),
    import("occt-import-js/dist/occt-import-js.wasm?url")
  ]);
  const occt = await occtimportjs({
    locateFile: () => wasmUrl
  });

  const content = new Uint8Array(bytes);
  const result =
    ext === "brep" || ext === "brp"
      ? occt.ReadBrepFile(content, null)
      : ext === "iges" || ext === "igs"
        ? occt.ReadIgesFile(content, null)
        : occt.ReadStepFile(content, null);
  if (!result?.success || !result.meshes?.length) {
    throw new Error(`could not tessellate ${ext} file in the browser`);
  }

  const group = new Group();
  for (const meshData of result.meshes) {
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      "position",
      new BufferAttribute(
        new Float32Array(meshData.attributes.position.array),
        3
      )
    );
    if (meshData.attributes.normal) {
      geometry.setAttribute(
        "normal",
        new BufferAttribute(
          new Float32Array(meshData.attributes.normal.array),
          3
        )
      );
    } else {
      geometry.computeVertexNormals();
    }
    geometry.setIndex(
      new BufferAttribute(new Uint32Array(meshData.index.array), 1)
    );
    const material = defaultMaterial();
    if (meshData.color) {
      material.color = new Color(
        meshData.color[0],
        meshData.color[1],
        meshData.color[2]
      );
    }
    group.add(new Mesh(geometry, material));
  }
  return group;
}

function defaultMaterial(): MeshStandardMaterial {
  // Matches the old WASM viewer's default part color (teal) for continuity.
  return new MeshStandardMaterial({
    color: new Color(0 / 255, 125 / 255, 125 / 255),
    metalness: 0.1,
    roughness: 0.6,
    side: DoubleSide
  });
}
