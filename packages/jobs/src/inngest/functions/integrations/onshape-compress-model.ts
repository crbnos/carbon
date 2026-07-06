/// <reference path="../../../types/draco3dgltf.d.ts" />
import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { promisify } from "node:util";
import { GLTFPACK_PATH } from "@carbon/env";
import { NodeIO } from "@gltf-transform/core";
import { KHRDracoMeshCompression } from "@gltf-transform/extensions";
import { draco } from "@gltf-transform/functions";
import draco3dgltf from "draco3dgltf";

// GLTF → viewer-ready GLB compression for oversized Onshape exports.
//
// Two stages, each load-bearing (benchmarked on a real 1.7GB assembly export):
//   1. Native gltfpack (-noq): dedups instanced geometry and packs the
//      embedded-base64 .gltf into a binary .glb. This MUST be the native
//      binary — Onshape embeds the whole buffer as base64 inside one JSON
//      file, which no JS/WASM tool can parse at this size (V8 caps strings at
//      ~536M chars; the WASM gltfpack hits its 4GB memory ceiling).
//      -noq is required: Carbon's viewer (online-3d-viewer) does not support
//      KHR_mesh_quantization or EXT_meshopt_compression.
//   2. gltf-transform Draco: compresses the packed .glb using the ONE
//      compression extension the viewer does support
//      (KHR_draco_mesh_compression). Reading the binary .glb keeps the JSON
//      chunk small, so Node handles it fine.
//
// Benchmark (whole-vehicle worst case): 1.73GB .gltf → 51MB full-fidelity,
// → 32MB at simplifyRatio 0.5. Typical released assemblies are far smaller.
//
// RENDER WEIGHT, not just file size: Draco compresses transmission — the
// browser decodes back to the packed mesh. In-app verification showed a 51MB
// Draco file whose packed mesh was 730MB silently hard-hangs the viewer tab,
// while a 32MB file with a 356MB packed mesh renders fine (~20-30s) even under
// headless software rendering (which is exactly how the model-thumbnail
// pipeline renders). So each candidate must pass BOTH caps: packed size
// (decoded render weight) AND final Draco size (storage/transfer), escalating
// mesh simplification until it does.

const execFileAsync = promisify(execFile);

// gltfpack/gltf-transform runtimes are bounded in practice (~15-25s each on a
// 1.7GB input) but leave generous headroom for slower hardware.
const COMPRESS_TIMEOUT_MS = 10 * 60 * 1000;

// Max decoded render weight, measured as the packed (pre-Draco) GLB size.
// Empirical: 730MB packed hung the viewer tab; 356MB rendered fine even under
// headless software GL (the model-thumbnail pipeline's environment).
const PACKED_RENDER_WEIGHT_MAX_BYTES = 400 * 1024 * 1024;

// Simplification ladder: full fidelity, then half, then quarter triangles.
const SIMPLIFY_LADDER = [null, 0.5, 0.25] as const;

// Resolve the native gltfpack binary: GLTFPACK_PATH env var, else PATH lookup.
// Returns null when unavailable — callers then skip oversized models instead
// of compressing them (the pre-compression behavior).
export async function resolveGltfpackPath(): Promise<string | null> {
  if (GLTFPACK_PATH) {
    try {
      await access(GLTFPACK_PATH, fsConstants.X_OK);
      return GLTFPACK_PATH;
    } catch {
      console.error(
        `onshape-compress-model: GLTFPACK_PATH is set but not executable: ${GLTFPACK_PATH}`
      );
      return null;
    }
  }
  try {
    const { stdout } = await execFileAsync("which", ["gltfpack"]);
    const found = stdout.trim();
    return found.length > 0 ? found : null;
  } catch {
    return null;
  }
}

// Stage 1: gltfpack -noq — dedup + binary pack (+ optional mesh
// simplification), emitting a plain .glb with no extensions the viewer lacks.
async function packGltf(
  gltfpackPath: string,
  inputPath: string,
  outputPath: string,
  simplifyRatio?: number
): Promise<void> {
  const gltfpackArguments = [
    "-i",
    inputPath,
    "-o",
    outputPath,
    "-noq",
    ...(simplifyRatio ? ["-si", String(simplifyRatio)] : [])
  ];
  await execFileAsync(gltfpackPath, gltfpackArguments, {
    timeout: COMPRESS_TIMEOUT_MS
  });
}

// Stage 2: Draco-compress a binary .glb in place of the packed intermediate.
async function dracoCompressGlb(
  inputPath: string,
  outputPath: string
): Promise<void> {
  const io = new NodeIO()
    .registerExtensions([KHRDracoMeshCompression])
    .registerDependencies({
      "draco3d.decoder": await draco3dgltf.createDecoderModule(),
      "draco3d.encoder": await draco3dgltf.createEncoderModule()
    });
  const gltfDocument = await io.read(inputPath);
  await gltfDocument.transform(draco());
  await io.write(outputPath, gltfDocument);
}

export interface CompressGltfResult {
  outputPath: string;
  outputBytes: number;
  simplifyRatio: number | null; // null = full fidelity
}

// Compress an Onshape .gltf export into a Draco .glb that both fits `maxBytes`
// on disk AND stays under the decoded render-weight cap (see
// PACKED_RENDER_WEIGHT_MAX_BYTES — an oversized decoded mesh hangs the viewer
// even when the Draco file is small). Walks the simplification ladder until a
// candidate passes both gates; returns null when none does — the caller should
// then treat the model as too large to attach. Writes intermediates next to
// `outputPath` (same scratch dir).
export async function compressGltfToViewerGlb(
  gltfpackPath: string,
  inputGltfPath: string,
  outputGlbPath: string,
  maxBytes: number
): Promise<CompressGltfResult | null> {
  const packedPath = `${outputGlbPath}.packed.glb`;

  for (const simplifyRatio of SIMPLIFY_LADDER) {
    await packGltf(
      gltfpackPath,
      inputGltfPath,
      packedPath,
      simplifyRatio ?? undefined
    );
    const packed = await stat(packedPath);
    if (packed.size > PACKED_RENDER_WEIGHT_MAX_BYTES) {
      // Too heavy to RENDER regardless of how small Draco gets it — skip the
      // encode and go straight to the next simplification step.
      console.warn(
        `onshape-compress-model: packed mesh is ${Math.round(
          packed.size / (1024 * 1024)
        )}MB (render-weight cap ${Math.round(
          PACKED_RENDER_WEIGHT_MAX_BYTES / (1024 * 1024)
        )}MB) at simplifyRatio=${simplifyRatio ?? "none"}`
      );
      continue;
    }
    await dracoCompressGlb(packedPath, outputGlbPath);
    const compressed = await stat(outputGlbPath);
    if (compressed.size <= maxBytes) {
      return {
        outputPath: outputGlbPath,
        outputBytes: compressed.size,
        simplifyRatio
      };
    }
    console.warn(
      `onshape-compress-model: output still ${Math.round(
        compressed.size / (1024 * 1024)
      )}MB (cap ${Math.round(maxBytes / (1024 * 1024))}MB) at simplifyRatio=${
        simplifyRatio ?? "none"
      }`
    );
  }

  return null;
}
