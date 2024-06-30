import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function deleteNote(
  client: SupabaseClient<Database>,
  noteId: string
) {
  return client.from("note").update({ active: false }).eq("id", noteId);
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

export async function upsertModelUpload(
  client: SupabaseClient<Database>,
  upload: {
    id: string;
    autodeskUrn: string;
    modelPath: string;
    itemId?: string;
    // rfqId?: string;
    // quoteId?: string;
    companyId: string;
    createdBy: string;
  }
) {
  return client.from("modelUpload").insert(upload);
}
