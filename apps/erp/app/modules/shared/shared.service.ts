import type { Database } from "@carbon/database";
import { supportedModelTypes } from "@carbon/utils";
import { FunctionRegion, type SupabaseClient } from "@supabase/supabase-js";
import type { GenericQueryFilters } from "~/utils/query";
import { setGenericQueryFilters } from "~/utils/query";
import type { documentTypes } from "./shared.models";

export async function deleteNote(
  client: SupabaseClient<Database>,
  noteId: string
) {
  return client.from("note").update({ active: false }).eq("id", noteId);
}

export async function deleteSavedView(
  client: SupabaseClient<Database>,
  viewId: string
) {
  return client.from("tableView").delete().eq("id", viewId);
}

export async function getBase64ImageFromSupabase(
  client: SupabaseClient<Database>,
  path: string
) {
  function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const binary = String.fromCharCode(...new Uint8Array(buffer));
    return btoa(binary);
  }

  const { data, error } = await client.storage.from("private").download(path);
  if (error) {
    return null;
  }

  const arrayBuffer = await data.arrayBuffer();
  const base64String = arrayBufferToBase64(arrayBuffer);

  // Determine the mime type based on file extension
  const fileExtension = path.split(".").pop()?.toLowerCase();
  const mimeType =
    fileExtension === "jpg" || fileExtension === "jpeg"
      ? "image/jpeg"
      : "image/png";

  return `data:${mimeType};base64,${base64String}`;
}

export async function getCountries(client: SupabaseClient<Database>) {
  return client.from("country").select("*").order("name");
}

export function getDocumentType(
  fileName: string
): (typeof documentTypes)[number] {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (["zip", "rar", "7z", "tar", "gz"].includes(extension)) {
    return "Archive";
  }

  if (["pdf"].includes(extension)) {
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

  if (["txt"].includes(extension)) {
    return "Text";
  }

  if (["png", "jpg", "jpeg", "gif", "avif"].includes(extension)) {
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

export async function getModelByItemId(
  client: SupabaseClient<Database>,
  itemId: string
) {
  const item = await client
    .from("item")
    .select("id, type, modelUploadId")
    .eq("id", itemId)
    .single();

  if (!item.data || !item.data.modelUploadId) {
    return {
      itemId: item.data?.id ?? null,
      type: item.data?.type ?? null,
      modelPath: null,
    };
  }

  const model = await client
    .from("modelUpload")
    .select("*")
    .eq("id", item.data.modelUploadId)
    .maybeSingle();

  if (!model.data) {
    return {
      itemId: item.data?.id ?? null,
      type: item.data?.type ?? null,
      modelSize: null,
    };
  }

  return {
    itemId: item.data!.id,
    type: item.data!.type,
    ...model.data,
  };
}

export async function getNotes(
  client: SupabaseClient<Database>,
  documentId: string
) {
  return client
    .from("note")
    .select("id, note, createdAt, user(id, fullName, avatarUrl)")
    .eq("documentId", documentId)
    .eq("active", true)
    .order("createdAt");
}

export async function getPeriods(
  client: SupabaseClient<Database>,
  { startDate, endDate }: { startDate: string; endDate: string }
) {
  const endWithTime = endDate.includes("T") ? endDate : `${endDate}T23:59:59`;
  return client
    .from("period")
    .select("*")
    .gte("startDate", startDate)
    .lte("endDate", endWithTime);
}

export async function getSavedViews(
  client: SupabaseClient<Database>,
  userId: string,
  companyId: string
) {
  return client
    .from("tableView")
    .select("*")
    .eq("createdBy", userId)
    .eq("companyId", companyId)
    .order("name");
}

export async function getTagsList(
  client: SupabaseClient<Database>,
  companyId: string,
  table?: string | null
) {
  let query = client.from("tag").select("name").eq("companyId", companyId);

  if (table) {
    query = query.eq("table", table);
  }

  return query.order("name");
}

export async function importCsv(
  client: SupabaseClient<Database>,
  args: {
    table: string;
    filePath: string;
    columnMappings: Record<string, string>;
    enumMappings?: Record<string, string[]>;
    companyId: string;
    userId: string;
  }
) {
  return client.functions.invoke("import-csv", {
    body: args,
    region: FunctionRegion.UsEast1,
  });
}

export async function insertNote(
  client: SupabaseClient<Database>,
  note: {
    note: string;
    documentId: string;
    companyId: string;
    createdBy: string;
  }
) {
  return client.from("note").insert([note]).select("*").single();
}

export async function insertTag(
  client: SupabaseClient<Database>,
  tag: Database["public"]["Tables"]["tag"]["Insert"]
) {
  return client.from("tag").insert(tag).select("*").single();
}

export async function upsertExternalLink(
  client: SupabaseClient<Database>,
  externalLink:
    | Database["public"]["Tables"]["externalLink"]["Insert"]
    | Database["public"]["Tables"]["externalLink"]["Update"]
) {
  if ("id" in externalLink && externalLink.id) {
    return client
      .from("externalLink")
      .update(externalLink)
      .eq("id", externalLink.id)
      .select("id")
      .single();
  }
  return client
    .from("externalLink")
    .insert(
      externalLink as Database["public"]["Tables"]["externalLink"]["Insert"]
    )
    .select("id")
    .single();
}

export async function getCustomerPortals(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("externalLink")
    .select("*", { count: "exact" })
    .eq("companyId", companyId)
    .eq("documentType", "Customer");

  if (args?.search) {
    query = query.ilike("customer.name", `%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "createdAt", ascending: false },
    ]);
  }

  return query;
}

export async function getCustomerPortal(
  client: SupabaseClient<Database>,
  id: string
) {
  return client
    .from("externalLink")
    .select("*, customer:customerId(id, name)")
    .eq("id", id)
    .eq("documentType", "Customer")
    .single();
}

export async function deleteCustomerPortal(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("externalLink").delete().eq("id", id);
}

export async function updateModelThumbnail(
  client: SupabaseClient<Database>,
  modelId: string,
  thumbnailPath: string
) {
  return client.from("modelUpload").update({ thumbnailPath }).eq("id", modelId);
}

export async function upsertModelUpload(
  client: SupabaseClient<Database>,
  upload:
    | {
        id: string;
        modelPath: string;
        companyId: string;
        createdBy: string;
      }
    | {
        id: string;
        name: string;
        size: number;
        thumbnailPath: string;
      }
) {
  if ("createdBy" in upload) {
    return client.from("modelUpload").insert(upload);
  }
  return client.from("modelUpload").update(upload).eq("id", upload.id);
}

export async function updateNote(
  client: SupabaseClient<Database>,
  id: string,
  note: string
) {
  return client.from("note").update({ note }).eq("id", id);
}

export async function upsertSavedView(
  client: SupabaseClient<Database>,
  view: {
    id?: string;
    name: string;
    description?: string;
    table: string;
    type: "Public" | "Private";
    filters?: string[];
    sorts?: string[];
    columnPinning?: Record<string, boolean>;
    columnVisibility?: Record<string, boolean>;
    columnOrder?: string[];
    userId: string;
    companyId: string;
  }
) {
  const { userId, ...data } = view;
  if ("id" in view && view.id) {
    return client
      .from("tableView")
      .update({
        ...data,
        updatedBy: userId,
      })
      .eq("id", view.id)
      .select("id")
      .single();
  }

  const { data: maxSortOrderData, error: maxSortOrderError } = await client
    .from("tableView")
    .select("sortOrder")
    .order("sortOrder", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (maxSortOrderError) {
    return { data: null, error: maxSortOrderError };
  }

  const newSortOrder = maxSortOrderData ? maxSortOrderData.sortOrder + 1 : 1;

  return client
    .from("tableView")
    .insert({
      ...data,
      createdBy: userId,
      sortOrder: newSortOrder,
    })
    .select("id")
    .single();
}

export async function updateSavedViewOrder(
  client: SupabaseClient<Database>,
  updates: {
    id: string;
    sortOrder: number;
    updatedBy: string;
  }[]
) {
  const updatePromises = updates.map(({ id, sortOrder, updatedBy }) =>
    client.from("tableView").update({ sortOrder, updatedBy }).eq("id", id)
  );
  return Promise.all(updatePromises);
}
