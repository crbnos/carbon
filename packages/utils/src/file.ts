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

// Image formats a step slide may use. The gate is decode support in EVERY
// browser the MES runs on — a slide is served byte-for-byte from storage and
// painted in an <img>, so anything Chrome/Firefox can't decode is a grey box on
// the shop floor with no error anywhere in the stack.
//
// Deliberately excluded:
//   heic/heif — Safari-only decoder (the payload is HEVC, which Chrome and
//     Firefox have never shipped). The iPhone camera default, so this is the
//     one users actually hit; iOS Safari's own photo picker hands the page a
//     JPEG, but a desktop upload of the original does not.
//   tiff, jxl — Safari-only for the same practical reason.
//   svg    — renders everywhere, but the preview route serves it from the app's
//     own origin with no CSP or Content-Disposition, so an SVG opened in a tab
//     executes script with the viewer's session. Not worth the XSS surface for
//     a reference photo.
export const supportedSlideImageTypes = [
  "avif",
  "gif",
  "jpeg",
  "jpg",
  "png",
  "webp"
];

/**
 * Whether a stored slide path (or filename) ends in a format the browser can
 * paint. Used at upload time to reject, and at render time to show an explicit
 * "unsupported format" placeholder for rows written before the gate existed.
 *
 * @param path Storage path or filename; a missing path is not supported.
 * @returns True when the extension is in {@link supportedSlideImageTypes}.
 */
export function isSupportedSlideImagePath(
  path: string | null | undefined
): boolean {
  if (!path) return false;
  const ext = path.toLowerCase().split(".").pop();
  return !!ext && supportedSlideImageTypes.includes(ext);
}

/**
 * Magic-number sniff for the allowed slide formats. `accept` is only a picker
 * filter and the browser's `file.type` is derived from the extension, so a
 * renamed `.heic` → `.jpg` passes both — reading the container header is the
 * only check that catches it. Identification only: the bytes are never decoded
 * or rewritten, and this stays a synchronous pure function (the caller does the
 * I/O and passes the header in).
 *
 * @param header The file's first bytes — 12 minimum, {@link SLIDE_IMAGE_HEADER_BYTES} covers every case.
 * @returns The canonical extension to store the file under, or null when the
 *   header matches nothing a browser can paint.
 */
export function sniffSlideImageType(header: Uint8Array): string | null {
  if (header.length < 12) return null;

  const startsWith = (...bytes: number[]) =>
    bytes.every((byte, index) => header[index] === byte);
  const asciiAt = (offset: number, text: string) =>
    text
      .split("")
      .every((char, i) => header[offset + i] === char.charCodeAt(0));

  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "png";
  if (startsWith(0xff, 0xd8, 0xff)) return "jpg";
  if (startsWith(0x47, 0x49, 0x46, 0x38)) return "gif";
  // RIFF....WEBP
  if (asciiAt(0, "RIFF") && asciiAt(8, "WEBP")) return "webp";
  // ISO-BMFF: ....ftyp<brand>. AVIF and HEIC share the container, so the major
  // brand is what separates a paintable file from a Safari-only one. Only the
  // major brand is read, never the compatible-brands list, so an AVIF written
  // with a generic `mif1` major brand is rejected too — erring toward a clear
  // "unsupported" message is the right failure, since the alternative direction
  // lets a HEIC through and ends as a grey box on the shop floor.
  if (asciiAt(4, "ftyp")) {
    const brand = String.fromCharCode(...header.slice(8, 12)).toLowerCase();
    if (brand === "avif" || brand === "avis") return "avif";
    return null;
  }
  return null;
}

/** Bytes of a file's head to read before calling {@link sniffSlideImageType}. */
export const SLIDE_IMAGE_HEADER_BYTES = 16;
