// Web Worker for the WASM raw-model parsers (occt-import-js, rhino3dm).
// Tessellating a real STEP file takes seconds-to-minutes of solid WASM compute;
// on the main thread that freezes scroll and paint for the whole tab. The
// worker does the parse and posts back plain transferable buffers (occt) or
// structured-cloneable three JSON (rhino) — the cheap Object3D assembly stays
// on the main thread in loadRawModel.ts.

/// <reference path="./occt-import-js.d.ts" />

export type RawWorkerPayload =
  | { kind: "occt"; bytes: ArrayBuffer; ext: string }
  | { kind: "rhino"; bytes: ArrayBuffer };

export type RawWorkerRequest = RawWorkerPayload & { id: number };

export type OcctWorkerMesh = {
  position: Float32Array;
  normal: Float32Array | null;
  index: Uint32Array;
  color: [number, number, number] | null;
};

export type RawWorkerResponse =
  | { id: number; occt: OcctWorkerMesh[] }
  | { id: number; rhino: object[] }
  | { id: number; error: string };

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<RawWorkerRequest>) => void) | null;
  postMessage: (msg: RawWorkerResponse, transfer?: Transferable[]) => void;
};

scope.onmessage = async (e: MessageEvent<RawWorkerRequest>) => {
  const req = e.data;
  try {
    if (req.kind === "occt") {
      const meshes = await runOcct(req.bytes, req.ext);
      const transfers: Transferable[] = [];
      for (const m of meshes) {
        transfers.push(m.position.buffer, m.index.buffer);
        if (m.normal) transfers.push(m.normal.buffer);
      }
      scope.postMessage({ id: req.id, occt: meshes }, transfers);
    } else {
      scope.postMessage({ id: req.id, rhino: await runRhino(req.bytes) });
    }
  } catch (err) {
    scope.postMessage({
      id: req.id,
      error: err instanceof Error ? err.message : String(err)
    });
  }
};

// WASM module instances are cached for the worker's lifetime — instantiation
// (fetch + compile) costs seconds and the module is stateless across reads.
let occtModule: Promise<{
  ReadStepFile: (c: Uint8Array, p: unknown) => OcctResultLike;
  ReadIgesFile: (c: Uint8Array, p: unknown) => OcctResultLike;
  ReadBrepFile: (c: Uint8Array, p: unknown) => OcctResultLike;
}> | null = null;
type OcctResultLike = {
  success: boolean;
  meshes: {
    attributes: {
      position: { array: number[] };
      normal?: { array: number[] };
    };
    index: { array: number[] };
    color?: [number, number, number];
  }[];
};

/** STEP/IGES/BREP → raw mesh buffers via the occt-import-js WASM build (OCCT
 *  compiled to WebAssembly — the same kernel the assembler uses server-side). */
async function runOcct(
  bytes: ArrayBuffer,
  ext: string
): Promise<OcctWorkerMesh[]> {
  occtModule ??= Promise.all([
    import("occt-import-js"),
    import("occt-import-js/dist/occt-import-js.wasm?url")
  ]).then(([{ default: occtimportjs }, { default: wasmUrl }]) =>
    occtimportjs({ locateFile: () => wasmUrl })
  );
  const occt = await occtModule;

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

  return result.meshes.map((meshData) => ({
    position: new Float32Array(meshData.attributes.position.array),
    normal: meshData.attributes.normal
      ? new Float32Array(meshData.attributes.normal.array)
      : null,
    index: new Uint32Array(meshData.index.array),
    color: meshData.color
      ? [meshData.color[0], meshData.color[1], meshData.color[2]]
      : null
  }));
}

/** Rhino .3dm via the official rhino3dm WASM: meshes are taken as-is; Breps and
 *  Extrusions contribute their embedded render meshes. Curves/points/annotations
 *  are skipped. Output is the plain `toThreejsJSON()` object per mesh —
 *  structured-cloneable; BufferGeometryLoader parses it on the main thread. */
let rhinoModule: Promise<
  Awaited<ReturnType<typeof import("rhino3dm").default>>
> | null = null;

async function runRhino(bytes: ArrayBuffer): Promise<object[]> {
  rhinoModule ??= Promise.all([
    import("rhino3dm"),
    import("rhino3dm/rhino3dm.wasm?url")
  ]).then(([{ default: rhino3dm }, { default: wasmUrl }]) => {
    // The shipped .d.ts types the factory as zero-arg, but it's an emscripten
    // module factory — it accepts the standard init object; locateFile points
    // the loader at Vite's hashed .wasm asset URL.
    const factory = rhino3dm as unknown as (opts: {
      locateFile: (path: string) => string;
    }) => ReturnType<typeof rhino3dm>;
    return factory({ locateFile: () => wasmUrl });
  });
  const rhino = await rhinoModule;
  const doc = rhino.File3dm.fromByteArray(new Uint8Array(bytes));
  if (!doc) throw new Error("could not read 3dm file");

  const out: object[] = [];
  const addRhinoMesh = (rhinoMesh: { toThreejsJSON: () => object }) => {
    out.push(rhinoMesh.toThreejsJSON());
  };

  const objects = doc.objects();
  for (let i = 0; i < objects.count; i++) {
    const geometry = objects.get(i)?.geometry();
    if (!geometry) continue;
    switch (geometry.objectType) {
      case rhino.ObjectType.Mesh:
        addRhinoMesh(geometry as unknown as { toThreejsJSON: () => object });
        break;
      case rhino.ObjectType.Brep: {
        const brep = geometry as unknown as {
          faces: () => {
            count: number;
            get: (i: number) => {
              getMesh: (t: unknown) => { toThreejsJSON: () => object } | null;
            };
          };
        };
        const faces = brep.faces();
        for (let f = 0; f < faces.count; f++) {
          const mesh = faces.get(f).getMesh(rhino.MeshType.Any);
          if (mesh) addRhinoMesh(mesh);
        }
        break;
      }
      case rhino.ObjectType.Extrusion: {
        const mesh = (
          geometry as unknown as {
            getMesh: (t: unknown) => { toThreejsJSON: () => object } | null;
          }
        ).getMesh(rhino.MeshType.Any);
        if (mesh) addRhinoMesh(mesh);
        break;
      }
      default:
        break;
    }
  }
  if (out.length === 0) {
    throw new Error("3dm file contains no renderable meshes");
  }
  return out;
}
