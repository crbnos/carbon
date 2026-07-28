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
import { rawCacheGet, rawCachePut } from "./rawCache";

export async function loadRawModel(source: RawSource): Promise<Object3D> {
  const ext = rawExtension(source.filename);
  if (!RAW_RENDERABLE_EXTS.includes(ext)) {
    throw new Error(`unsupported raw model format: ${ext || "unknown"}`);
  }
  if (ext === "glb" || ext === "gltf") return loadGltf(source);

  // Cache-first for the WASM-parsed formats: the STEP parse is ~40s of solid
  // compute, so a prior visit's parsed buffers replay from IndexedDB without
  // even fetching the raw. URL-keyed only (uploads mint a new path per file);
  // just-dropped local Files skip the cache.
  const isOcct = ![
    "stl",
    "obj",
    "ply",
    "dae",
    "fbx",
    "3ds",
    "3mf",
    "amf",
    "off",
    "bim",
    "3dm"
  ].includes(ext);
  const cacheKey =
    isOcct && !source.file && source.url
      ? new URL(source.url, globalThis.location?.origin ?? "http://x").pathname
      : null;
  if (cacheKey) {
    const cached = await rawCacheGet(cacheKey);
    if (cached) return occtMeshesToGroup(cached);
  }

  const bytes = await readBytes(source);
  switch (ext) {
    case "stl":
      return loadStl(bytes);
    case "obj":
    case "ply":
    case "dae":
    case "fbx":
    case "3ds":
    case "3mf":
    case "amf":
      return loadMesh(bytes, ext);
    case "off":
      return loadOff(bytes);
    case "bim":
      return loadDotbim(bytes);
    case "3dm":
      return loadRhino(bytes);
    default:
      return loadOcct(bytes, ext, cacheKey);
  }
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

/** The three-stdlib mesh loaders (no WASM): obj/ply/dae/fbx/3ds/3mf/amf. Their
 *  own materials are kept when the format carries them; bare geometry gets the
 *  default part material and computed normals. */
async function loadMesh(bytes: ArrayBuffer, ext: string): Promise<Object3D> {
  const stdlib = await import("three-stdlib");
  const text = () => new TextDecoder().decode(bytes);
  let object: Object3D;
  switch (ext) {
    case "obj":
      object = new stdlib.OBJLoader().parse(text());
      break;
    case "ply": {
      const geometry = new stdlib.PLYLoader().parse(bytes);
      if (!geometry.attributes.normal) geometry.computeVertexNormals();
      const material = defaultMaterial();
      if (geometry.attributes.color) material.vertexColors = true;
      return new Mesh(geometry, material);
    }
    case "dae":
      object = new stdlib.ColladaLoader().parse(text(), "").scene;
      break;
    case "fbx":
      object = new stdlib.FBXLoader().parse(bytes, "");
      break;
    case "3ds":
      object = new stdlib.TDSLoader().parse(bytes, "");
      break;
    case "3mf":
      object = new stdlib.ThreeMFLoader().parse(bytes);
      break;
    case "amf":
      object = new stdlib.AMFLoader().parse(bytes);
      break;
    default:
      throw new Error(`unsupported mesh format: ${ext}`);
  }
  object.traverse((child) => {
    const mesh = child as Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    if (!mesh.geometry.attributes.normal) mesh.geometry.computeVertexNormals();
    if (!mesh.material) mesh.material = defaultMaterial();
  });
  return object;
}

/** OFF (Object File Format): tiny text format, hand-parsed — no loader ships in
 *  three-stdlib. Polygon faces are fan-triangulated. */
async function loadOff(bytes: ArrayBuffer): Promise<Object3D> {
  const tokens = new TextDecoder()
    .decode(bytes)
    .split("\n")
    .map((line) => line.replace(/#.*$/, "").trim())
    .filter(Boolean)
    .join(" ")
    .split(/\s+/);
  let i = 0;
  if (tokens[i] === "OFF") i++;
  const nVerts = Number(tokens[i++]);
  const nFaces = Number(tokens[i++]);
  i++; // edge count, unused
  if (!Number.isFinite(nVerts) || !Number.isFinite(nFaces)) {
    throw new Error("invalid OFF file");
  }
  const positions = new Float32Array(nVerts * 3);
  for (let v = 0; v < nVerts * 3; v++) positions[v] = Number(tokens[i++]);
  const indices: number[] = [];
  for (let f = 0; f < nFaces; f++) {
    const count = Number(tokens[i++]);
    const face: number[] = [];
    for (let c = 0; c < count; c++) face.push(Number(tokens[i++]));
    for (let t = 1; t + 1 < face.length; t++) {
      const [a, b, c] = [face[0], face[t], face[t + 1]];
      if (a === undefined || b === undefined || c === undefined) continue;
      indices.push(a, b, c);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return new Mesh(geometry, defaultMaterial());
}

// ---------------------------------------------------------------------------
// WASM parsers (occt-import-js, rhino3dm) run in a Web Worker — a real STEP
// tessellation is seconds-to-minutes of solid compute, which on the main
// thread freezes scroll/paint for the whole tab. The worker posts back plain
// buffers; only the cheap Object3D assembly happens here.

import type {
  OcctWorkerMesh,
  RawWorkerPayload,
  RawWorkerResponse
} from "./rawWorker";

let rawWorker: Worker | null = null;
let rawWorkerSeq = 0;
const rawWorkerPending = new Map<
  number,
  {
    resolve: (r: RawWorkerResponse) => void;
    reject: (e: Error) => void;
  }
>();

function getRawWorker(): Worker {
  if (rawWorker) return rawWorker;
  const worker = new Worker(new URL("./rawWorker.ts", import.meta.url), {
    type: "module"
  });
  worker.onmessage = (e: MessageEvent<RawWorkerResponse>) => {
    const pending = rawWorkerPending.get(e.data.id);
    if (!pending) return;
    rawWorkerPending.delete(e.data.id);
    pending.resolve(e.data);
  };
  // A fatal worker error (emscripten abort, OOM on a huge model) kills every
  // in-flight parse; drop the worker so the next load starts a fresh one.
  worker.onerror = (e) => {
    const err = new Error(e.message || "raw model worker crashed");
    for (const pending of rawWorkerPending.values()) pending.reject(err);
    rawWorkerPending.clear();
    worker.terminate();
    if (rawWorker === worker) rawWorker = null;
  };
  rawWorker = worker;
  return worker;
}

function requestRawWorker(
  req: RawWorkerPayload,
  transfer: Transferable[]
): Promise<RawWorkerResponse> {
  const id = ++rawWorkerSeq;
  return new Promise<RawWorkerResponse>((resolve, reject) => {
    rawWorkerPending.set(id, { resolve, reject });
    getRawWorker().postMessage({ ...req, id }, transfer);
  }).then((response) => {
    if ("error" in response) throw new Error(response.error);
    return response;
  });
}

/** STEP/IGES/BREP → meshes via the occt-import-js WASM build (OCCT compiled to
 *  WebAssembly — the same kernel the assembler uses server-side), tessellated
 *  off-thread. A successful parse is persisted to the IndexedDB cache (when a
 *  `cacheKey` is given) so later visits replay it instead of re-parsing. */
async function loadOcct(
  bytes: ArrayBuffer,
  ext: string,
  cacheKey: string | null = null
): Promise<Object3D> {
  const response = await requestRawWorker({ kind: "occt", bytes, ext }, [
    bytes
  ]);
  const meshes = (response as { occt: OcctWorkerMesh[] }).occt;
  if (cacheKey) void rawCachePut(cacheKey, meshes);
  return occtMeshesToGroup(meshes);
}

function occtMeshesToGroup(meshes: OcctWorkerMesh[]): Object3D {
  const group = new Group();
  for (const meshData of meshes) {
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      "position",
      new BufferAttribute(meshData.position, 3)
    );
    if (meshData.normal) {
      geometry.setAttribute("normal", new BufferAttribute(meshData.normal, 3));
    }
    geometry.setIndex(new BufferAttribute(meshData.index, 1));
    if (!meshData.normal) geometry.computeVertexNormals();
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

/** dotbim (.bim): plain JSON — shared meshes instanced by elements carrying a
 *  translation + quaternion + color. Hand-parsed; no dependency. */
async function loadDotbim(bytes: ArrayBuffer): Promise<Object3D> {
  type DotbimElement = {
    mesh_id: number;
    vector?: { x: number; y: number; z: number };
    rotation?: { qx: number; qy: number; qz: number; qw: number };
    color?: { r: number; g: number; b: number; a: number };
  };
  type DotbimFile = {
    meshes?: { mesh_id: number; coordinates: number[]; indices: number[] }[];
    elements?: DotbimElement[];
  };
  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as DotbimFile;
  if (!parsed.meshes?.length) throw new Error("invalid dotbim file");

  const geometries = new Map<number, BufferGeometry>();
  for (const m of parsed.meshes) {
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      "position",
      new BufferAttribute(new Float32Array(m.coordinates), 3)
    );
    geometry.setIndex(new BufferAttribute(new Uint32Array(m.indices), 1));
    geometry.computeVertexNormals();
    geometries.set(m.mesh_id, geometry);
  }

  const group = new Group();
  const elements: DotbimElement[] = parsed.elements?.length
    ? parsed.elements
    : [...geometries.keys()].map((mesh_id) => ({ mesh_id }));
  for (const el of elements) {
    const geometry = geometries.get(el.mesh_id);
    if (!geometry) continue;
    const material = defaultMaterial();
    if (el.color) {
      material.color = new Color(
        el.color.r / 255,
        el.color.g / 255,
        el.color.b / 255
      );
      if (el.color.a < 255) {
        material.transparent = true;
        material.opacity = el.color.a / 255;
      }
    }
    const mesh = new Mesh(geometry, material);
    if (el.rotation) {
      mesh.quaternion.set(
        el.rotation.qx,
        el.rotation.qy,
        el.rotation.qz,
        el.rotation.qw
      );
    }
    if (el.vector) mesh.position.set(el.vector.x, el.vector.y, el.vector.z);
    group.add(mesh);
  }
  return group;
}

/** Rhino .3dm via the official rhino3dm WASM, parsed off-thread. The worker
 *  extracts each renderable mesh's `toThreejsJSON()` object; only the
 *  BufferGeometryLoader assembly runs here. */
async function loadRhino(bytes: ArrayBuffer): Promise<Object3D> {
  const response = await requestRawWorker({ kind: "rhino", bytes }, [bytes]);
  const meshJsons = (response as { rhino: object[] }).rhino;

  const { BufferGeometryLoader } = await import("three");
  const geometryLoader = new BufferGeometryLoader();
  const group = new Group();
  for (const meshJson of meshJsons) {
    const geometry = geometryLoader.parse(meshJson);
    if (!geometry.attributes.normal) geometry.computeVertexNormals();
    group.add(new Mesh(geometry, defaultMaterial()));
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
