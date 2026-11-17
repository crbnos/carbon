// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import {
  getBuiltInSection,
  type ResolvedSection
} from "@carbon/documents/template";
import { getContentType, getFileExtension, storage } from "@carbon/files";
import { renderToStream } from "@react-pdf/renderer";
import type { SupabaseClient } from "@supabase/supabase-js";

// Reads shared by the document loaders (sales invoice, packing slip). No app
// imports, so the ERP and Inngest jobs render the same documents.

type Client = SupabaseClient<Database>;

/** The document a loader was asked for does not exist in this company. */
export class DocumentNotFoundError extends Error {}

/** Render a React PDF document into a Buffer. */
export async function renderPdfToBuffer(
  element: Parameters<typeof renderToStream>[0]
): Promise<Buffer> {
  const stream = await renderToStream(element);
  return new Promise((resolve, reject) => {
    const buffers: Uint8Array[] = [];
    stream.on("data", (data: Uint8Array) => buffers.push(data));
    stream.on("end", () => resolve(Buffer.concat(buffers)));
    stream.on("error", reject);
  });
}

const LOGO_FIELDS = [
  "logoLight",
  "logoDark",
  "logoLightIcon",
  "logoDarkIcon",
  "logoWatermark"
] as const;

/** The company row with its logo paths expanded to public URLs under `storageUrl`. */
export async function getCompanyWithPublicLogos(
  client: Client,
  companyId: string,
  storageUrl: string
) {
  const company = await client
    .from("company")
    .select("*")
    .eq("id", companyId)
    .single();
  if (company.error) return company;

  const prefix = `${storageUrl}/storage/v1/object/public/public/`;
  const data = { ...company.data };
  for (const field of LOGO_FIELDS) {
    data[field] = company.data[field]
      ? `${prefix}${company.data[field]}`
      : null;
  }
  return { data, error: null };
}

/** A document template's sections: built-in ones from code, the rest from the DB. */
export async function resolveSections(
  client: Client,
  companyId: string,
  ids: string[]
): Promise<Record<string, ResolvedSection>> {
  if (ids.length === 0) return {};
  const map: Record<string, ResolvedSection> = {};

  // System sections live in code, not the DB. Seed them first so a stored row
  // with the same id (a customized/forked default) overrides below.
  for (const id of ids) {
    const builtIn = getBuiltInSection(id);
    if (builtIn) map[id] = builtIn;
  }

  const dbIds = ids.filter((id) => !map[id] || map[id]?.builtIn);
  const { data } = await client
    .from("documentSection")
    .select("*")
    .eq("companyId", companyId)
    .in("id", dbIds);
  for (const row of (data ?? []) as ResolvedSection[]) {
    map[row.id] = {
      id: row.id,
      name: row.name,
      placement: row.placement,
      content: row.content,
      config: row.config
    };
  }
  return map;
}

/** A stored image as a data URI for the PDF renderer, or null when it cannot be read. */
export async function getBase64Image(client: Client, path: string) {
  // Legacy stored HEIC can't be decoded by the PDF renderer — serve the
  // imgproxy JPEG rendition instead. Everything else passes through raw.
  const extension = getFileExtension(path);
  const heic = extension === "heic" || extension === "heif";

  // Private object paths are prefixed with the owning company's id.
  const companyId = path.split("/")[0];
  if (!companyId) return null;
  // Demo-template artwork is bundled with the app, not uploaded.
  if (path.startsWith("_templates/")) return null;

  const { data } = await storage(client)
    .company(companyId)
    .download(path, heic ? { transform: { quality: 90 } } : undefined);
  if (!data) return null;

  const base64String = Buffer.from(await data.arrayBuffer()).toString("base64");

  const contentType = heic ? "image/jpeg" : getContentType(extension);
  const mimeType = contentType.startsWith("image/") ? contentType : "image/png";

  return `data:${mimeType};base64,${base64String}`;
}
