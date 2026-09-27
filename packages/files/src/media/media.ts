import { supportedModelTypes } from "../cad/model";

export const documentTypes = [
  "Archive",
  "Document",
  "Presentation",
  "PDF",
  "Spreadsheet",
  "Text",
  "Image",
  "Video",
  "Audio",
  "Model",
  "Other"
] as const;

export type DocumentType = (typeof documentTypes)[number];

/** Document classes the in-app preview (iframe/img) can render inline. */
export type PreviewableDocumentType = Extract<DocumentType, "PDF" | "Image">;

export function isPreviewableDocumentType(
  type: DocumentType
): type is PreviewableDocumentType {
  return type === "PDF" || type === "Image";
}

// The one extension → Content-Type map for every file-serving route. `glb`
// uses the registered `model/gltf-binary` (one route previously said
// `application/glb`; loaders fetch bytes, so unifying is safe).
export const MEDIA_CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  svg: "image/svg+xml",
  avif: "image/avif",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  avi: "video/x-msvideo",
  wmv: "video/x-ms-wmv",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  flac: "audio/flac",
  dxf: "application/dxf",
  dwg: "application/dxf",
  stl: "application/stl",
  obj: "application/obj",
  glb: "model/gltf-binary",
  gltf: "application/gltf",
  fbx: "application/fbx",
  ply: "application/ply",
  off: "application/off",
  step: "application/step",
  stp: "application/step",
  iges: "application/iges",
  igs: "application/iges",
  brep: "application/octet-stream",
  "3dm": "application/octet-stream",
  "3ds": "application/octet-stream",
  "3mf": "model/3mf",
  amf: "application/octet-stream",
  bim: "application/octet-stream",
  dae: "model/vnd.collada+xml"
};

export function getFileExtension(path: string): string {
  const index = path.lastIndexOf(".");
  return index === -1 ? "" : path.slice(index + 1).toLowerCase();
}

// Retained CAD raws are stored zstd-compressed (`raw.step.zst`, …); the
// content type comes from the underlying format, not the `.zst` wrapper.
export function effectiveExtension(path: string): string {
  const extension = getFileExtension(path);
  return extension === "zst" ? getFileExtension(path.slice(0, -4)) : extension;
}

// A bare octet-stream beats omitting the header (browsers may otherwise
// sniff or mangle the download).
export function getContentType(extension: string): string {
  return (
    MEDIA_CONTENT_TYPES[extension.toLowerCase()] ?? "application/octet-stream"
  );
}

export function isHeic(fileName: string, mimeType?: string | null): boolean {
  const extension = getFileExtension(fileName);
  return (
    extension === "heic" ||
    extension === "heif" ||
    mimeType === "image/heic" ||
    mimeType === "image/heif" ||
    mimeType === "image/heic-sequence" ||
    mimeType === "image/heif-sequence"
  );
}

export function getDocumentType(fileName: string): DocumentType {
  const extension = getFileExtension(fileName);
  if (["zip", "rar", "7z", "tar", "gz"].includes(extension)) {
    return "Archive";
  }
  if (extension === "pdf") {
    return "PDF";
  }
  if (["doc", "docx", "txt", "rtf"].includes(extension)) {
    return "Document";
  }
  if (["ppt", "pptx"].includes(extension)) {
    return "Presentation";
  }
  if (["csv", "xls", "xlsx"].includes(extension)) {
    return "Spreadsheet";
  }
  if (
    ["png", "jpg", "jpeg", "gif", "avif", "webp", "heic", "heif"].includes(
      extension
    )
  ) {
    return "Image";
  }
  if (["mp4", "mov", "avi", "wmv", "flv", "mkv"].includes(extension)) {
    return "Video";
  }
  if (["mp3", "wav", "wma", "aac", "ogg", "flac"].includes(extension)) {
    return "Audio";
  }
  if (supportedModelTypes.includes(extension)) {
    return "Model";
  }
  return "Other";
}

// MIME types the image-upload forms accept. HEIC/HEIF are converted to JPEG
// before anything is stored — see image.ts.
export const IMAGE_UPLOAD_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif"
];
