// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Files on a person's page, and the ticks of a card's checklist. A file is
// stored in the company's bucket under the person's folder and recorded in
// `implementationFile` against one card; the person attaches files to the
// cards that ask for one, and Carbon staff to any card. Pure, so the page and
// the server apply the same rules.

import type { ImplementationFileRow } from "../types";
import { checkKey } from "./keys";

// The company bucket's own limit (`file_size_limit`, 50 MB).
export const PAGE_FILE_MAX_BYTES = 50 * 1024 * 1024;

// What a page takes: documents, images, spreadsheets, presentations, PDFs and
// CAD drawings. Nothing that runs, and no archives, which hide what they hold.
// HEIC photos are stored as JPEG by the upload.
export const PAGE_FILE_EXTENSIONS = [
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "heic",
  "heif",
  "txt",
  "md",
  "rtf",
  "doc",
  "docx",
  "odt",
  "csv",
  "xls",
  "xlsx",
  "ods",
  "ppt",
  "pptx",
  "odp",
  "step",
  "stp",
  "iges",
  "igs",
  "dxf",
  "dwg",
  "stl"
] as const;

const ALLOWED = new Set<string>(PAGE_FILE_EXTENSIONS);

// The file input's accept list.
export const PAGE_FILE_ACCEPT = PAGE_FILE_EXTENSIONS.map(
  (extension) => `.${extension}`
).join(",");

const extensionOf = (name: string) => {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
};

export const isPageFileType = (name: string) => ALLOWED.has(extensionOf(name));

// Why a file cannot be attached, before it is uploaded; null when it can.
export function pageFileRefusal(file: {
  name: string;
  size: number;
}): "type" | "size" | null {
  if (!isPageFileType(file.name)) return "type";
  if (file.size > PAGE_FILE_MAX_BYTES) return "size";
  return null;
}

// The folder a person's page files are stored under, in the company's bucket.
export const pageFilePrefix = (companyId: string, memberId: string) =>
  `${companyId}/implementation/${memberId}/`;

// Where one upload is stored: a folder of its own, so two files of the same
// name never replace each other.
export const pageFilePath = (
  companyId: string,
  memberId: string,
  folder: string,
  name: string
) => `${pageFilePrefix(companyId, memberId)}${folder}/${name}`;

const SAFE_SEGMENT = /^[^/\\?#%]+$/;

// Pure: why the server refuses to record a file; null when it may. The path
// must be in the person's folder, one folder deep, and end in the file's
// name.
export function attachedFileProblem(
  file: { path: string; name: string; size: number },
  companyId: string,
  memberId: string
): string | null {
  const prefix = pageFilePrefix(companyId, memberId);
  if (!file.path.startsWith(prefix)) {
    return "The file is not in this person's folder";
  }
  const segments = file.path.slice(prefix.length).split("/");
  if (
    segments.length !== 2 ||
    segments.some(
      (segment) =>
        !SAFE_SEGMENT.test(segment) || segment === "." || segment === ".."
    ) ||
    segments[1] !== file.name
  ) {
    return "The file's path is not one this page stores";
  }
  if (file.name.length > 255) return "The file's name is too long";
  if (!isPageFileType(file.name)) {
    return "This type of file cannot be attached";
  }
  if (file.size > PAGE_FILE_MAX_BYTES) return "The file is larger than 50 MB";
  return null;
}

// Pure: may this viewer remove the file? Carbon staff remove any; a person
// removes the files they attached.
export function canRemovePageFile(
  file: Pick<ImplementationFileRow, "createdBy">,
  viewer: { userId: string; isInternal: boolean }
): boolean {
  return viewer.isInternal || file.createdBy === viewer.userId;
}

// Pure: a page's files by the card they are attached to, oldest first.
export function filesByCard(
  files: ImplementationFileRow[]
): Map<string, ImplementationFileRow[]> {
  const byCard = new Map<string, ImplementationFileRow[]>();
  const sorted = [...files].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt)
  );
  for (const file of sorted) {
    byCard.set(file.cardId, [...(byCard.get(file.cardId) ?? []), file]);
  }
  return byCard;
}

// A file's size as people read it: 512 B, 34 KB, 2.1 MB.
export function formatFileSize(bytes: number, locale?: string): string {
  const format = (value: number, digits: number) =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(
      value
    );
  if (bytes < 1024) return `${format(bytes, 0)} B`;
  if (bytes < 1024 * 1024) return `${format(bytes / 1024, 0)} KB`;
  return `${format(bytes / (1024 * 1024), 1)} MB`;
}

// FNV-1a, 32 bits, in base 36: a short, stable name for a point's text.
function textHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

// A person's tick on one point of a card's checklist. Kept under the point's
// text: a point staff reword is a new point, ticked afresh.
export const pointKey = (userId: string, cardId: string, point: string) =>
  checkKey("point", `${userId}.${cardId}.${textHash(point.trim())}`);
