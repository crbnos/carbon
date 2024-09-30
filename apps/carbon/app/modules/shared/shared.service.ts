import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function deleteNote(
  client: SupabaseClient<Database>,
  noteId: string
) {
  return client.from("note").update({ active: false }).eq("id", noteId);
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
  return `data:image/png;base64,${base64String}`;
}

export async function getCountries(client: SupabaseClient<Database>) {
  return client.from("country").select("*").order("name");
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

export async function updateNote(
  client: SupabaseClient<Database>,
  id: string,
  note: string
) {
  return client.from("note").update({ note }).eq("id", id);
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
        autodeskUrn: string;
        thumbnailPath: string;
      }
) {
  if ("createdBy" in upload) {
    return client.from("modelUpload").insert(upload);
  }
  return client.from("modelUpload").update(upload).eq("id", upload.id);
}
