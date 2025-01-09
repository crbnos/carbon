import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import type { GenericQueryFilters } from "~/utils/query";
import { setGenericQueryFilters } from "~/utils/query";
import { sanitize } from "~/utils/supabase";
import { getDocumentType } from "../shared/shared.service";
import type {
  documentLabelsValidator,
  documentSourceTypes,
  documentValidator,
} from "./documents.models";

export async function deleteDocument(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("document").delete().eq("id", id);
}

export async function deleteDocumentFavorite(
  client: SupabaseClient<Database>,
  id: string,
  userId: string
) {
  return client
    .from("documentFavorite")
    .delete()
    .eq("documentId", id)
    .eq("userId", userId);
}

export async function deleteDocumentLabel(
  client: SupabaseClient<Database>,
  id: string,
  label: string
) {
  return client
    .from("documentLabel")
    .delete()
    .eq("documentId", id)
    .eq("label", label);
}

export async function getDocument(
  client: SupabaseClient<Database>,
  documentId: string
) {
  return client.from("documents").select("*").eq("id", documentId).single();
}

export async function getDocuments(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
    favorite?: boolean;
    recent?: boolean;
    createdBy?: string;
    active: boolean;
  }
) {
  let query = client
    .from("documents")
    .select("*", {
      count: "exact",
    })
    .eq("companyId", companyId)
    .eq("active", args.active);

  if (args?.search) {
    query = query.or(
      `name.ilike.%${args.search}%,description.ilike.%${args.search}%`
    );
  }

  if (args?.favorite) {
    query = query.eq("favorite", true);
  }

  if (args.recent) {
    query = query.order("lastActivityAt", { ascending: false });
  }

  query = setGenericQueryFilters(query, args, [
    { column: "favorite", ascending: false },
  ]);

  return query;
}

export async function getDocumentExtensions(client: SupabaseClient<Database>) {
  return client.from("documentExtensions").select("extension");
}

export async function getDocumentLabels(
  client: SupabaseClient<Database>,
  userId: string
) {
  return client.from("documentLabels").select("*").eq("userId", userId);
}

export async function insertDocumentFavorite(
  client: SupabaseClient<Database>,
  id: string,
  userId: string
) {
  return client.from("documentFavorite").insert({ documentId: id, userId });
}

export async function insertDocumentLabel(
  client: SupabaseClient<Database>,
  id: string,
  label: string,
  userId: string
) {
  return client.from("documentLabel").insert({ documentId: id, label, userId });
}

export async function moveDocumentToTrash(
  client: SupabaseClient<Database>,
  id: string,
  userId: string
) {
  return client
    .from("document")
    .update({
      active: false,
      updatedBy: userId,
      updatedAt: new Date().toISOString(),
    })
    .eq("id", id);
}

export async function restoreDocument(
  client: SupabaseClient<Database>,
  id: string,
  userId: string
) {
  return client
    .from("document")
    .update({
      active: true,
      updatedBy: userId,
      updatedAt: new Date().toISOString(),
    })
    .eq("id", id);
}

type SourceDocumentData = {
  sourceDocument?: (typeof documentSourceTypes)[number];
  sourceDocumentId?: string;
};

export async function upsertDocument(
  client: SupabaseClient<Database>,
  document:
    | (Omit<z.infer<typeof documentValidator>, "id"> & {
        path: string;
        size: number;
        companyId: string;
        createdBy: string;
      } & SourceDocumentData)
    | (Omit<z.infer<typeof documentValidator>, "id"> & {
        id: string;
        updatedBy: string;
      })
) {
  const type = getDocumentType(document.name ?? "");
  if ("createdBy" in document) {
    return (
      client
        .from("document")
        // @ts-ignore
        .insert({ ...document, type })
        .select("*")
        .single()
    );
  }

  const { extension, ...data } = document;
  return client
    .from("document")
    .update(
      sanitize({
        ...data,
        type,
        updatedAt: new Date().toISOString(),
      })
    )
    .eq("id", document.id);
}

export async function updateDocumentFavorite(
  client: SupabaseClient<Database>,
  args: {
    id: string;
    favorite: boolean;
    userId: string;
  }
) {
  const { id, favorite, userId } = args;
  if (!favorite) {
    return client
      .from("documentFavorite")
      .delete()
      .eq("documentId", id)
      .eq("userId", userId);
  } else {
    return client
      .from("documentFavorite")
      .insert({ documentId: id, userId: userId });
  }
}

export async function updateDocumentLabels(
  client: SupabaseClient<Database>,
  document: z.infer<typeof documentLabelsValidator> & {
    userId: string;
  }
) {
  if (!document.labels) {
    throw new Error("No labels provided");
  }

  return client
    .from("documentLabel")
    .delete()
    .eq("documentId", document.documentId)
    .eq("userId", document.userId)
    .then(() => {
      return client.from("documentLabel").insert(
        // @ts-ignore
        document.labels.map((label) => ({
          documentId: document.documentId,
          label,
          userId: document.userId,
        }))
      );
    });
}
