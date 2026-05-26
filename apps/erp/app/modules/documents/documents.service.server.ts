import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  AuthContextHolder,
  getAuthClient,
  mcpTool
} from "~/services/mcp/index.server";
import type { GenericQueryFilters } from "~/utils/query";
import { setGenericQueryFilters } from "~/utils/query";
import { sanitize } from "~/utils/supabase";
import { getDocumentType } from "../shared/shared.models";
import type {
  documentLabelsValidator,
  documentSourceTypes,
  documentValidator
} from "./documents.models";
export const deleteDocument = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteDocument(id: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("document").delete().eq("id", id);
  }
);

export const deleteDocumentFavorite = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteDocumentFavorite(id: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { userId } = AuthContextHolder.get();
    return client
      .from("documentFavorite")
      .delete()
      .eq("documentId", id)
      .eq("userId", userId);
  }
);

export const deleteDocumentLabel = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteDocumentLabel(id: string, label: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("documentLabel")
      .delete()
      .eq("documentId", id)
      .eq("label", label);
  }
);

export const getDocument = mcpTool(
  {
    classification: "READ"
  },
  async function getDocument(documentId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("documents").select("*").eq("id", documentId).single();
  }
);

export const getDocuments = mcpTool(
  {
    classification: "READ",
    schema: z.object({
      args: z.object({
        limit: z.number().int().default(100),
        offset: z.number().int().default(0),
        search: z.string().nullable(),
        favorite: z.boolean().optional(),
        recent: z.boolean().optional(),
        active: z.boolean()
      })
    })
  },
  async function getDocuments(
    args: GenericQueryFilters & {
      search: string | null;
      favorite?: boolean;
      recent?: boolean;
      createdBy?: string;
      active: boolean;
    }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    let query = client
      .from("documents")
      .select("*", {
        count: "exact"
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
      { column: "favorite", ascending: false }
    ]);

    return query;
  }
);

export const getDocumentExtensions = mcpTool(
  {
    classification: "READ"
  },
  async function getDocumentExtensions() {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("documentExtensions").select("extension");
  }
);

export const getDocumentLabels = mcpTool(
  {
    classification: "READ"
  },
  async function getDocumentLabels() {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { userId } = AuthContextHolder.get();
    return client.from("documentLabels").select("*").eq("userId", userId);
  }
);

export const insertDocumentFavorite = mcpTool(
  {
    classification: "WRITE"
  },
  async function insertDocumentFavorite(id: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { userId } = AuthContextHolder.get();
    return client.from("documentFavorite").insert({ documentId: id, userId });
  }
);

export const insertDocumentLabel = mcpTool(
  {
    classification: "WRITE"
  },
  async function insertDocumentLabel(id: string, label: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { userId } = AuthContextHolder.get();
    return client
      .from("documentLabel")
      .insert({ documentId: id, label, userId });
  }
);

export const moveDocumentToTrash = mcpTool(
  {
    classification: "WRITE"
  },
  async function moveDocumentToTrash(id: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { userId } = AuthContextHolder.get();
    return client
      .from("document")
      .update({
        active: false,
        updatedBy: userId,
        updatedAt: new Date().toISOString()
      })
      .eq("id", id);
  }
);

export const restoreDocument = mcpTool(
  {
    classification: "WRITE"
  },
  async function restoreDocument(id: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { userId } = AuthContextHolder.get();
    return client
      .from("document")
      .update({
        active: true,
        updatedBy: userId,
        updatedAt: new Date().toISOString()
      })
      .eq("id", id);
  }
);

type SourceDocumentData = {
  sourceDocument?: (typeof documentSourceTypes)[number];
  sourceDocumentId?: string;
};

export const upsertDocument = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertDocument(
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
    const client = getAuthClient<SupabaseClient<Database>>();
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

    // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
    const { extension, ...data } = document;
    return client
      .from("document")
      .update(
        sanitize({
          ...data,
          type,
          updatedAt: new Date().toISOString()
        })
      )
      .eq("id", document.id);
  }
);

export const updateDocumentFavorite = mcpTool(
  {
    classification: "WRITE",
    schema: z.object({
      args: z.object({ id: z.string(), favorite: z.boolean() })
    })
  },
  async function updateDocumentFavorite(args: {
    id: string;
    favorite: boolean;
  }) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { id, favorite } = args;
    const { userId } = AuthContextHolder.get();
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
);

export const updateDocumentLabels = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateDocumentLabels(
    document: z.infer<typeof documentLabelsValidator> & {
      userId: string;
    }
  ) {
    const { userId } = AuthContextHolder.get();
    const client = getAuthClient<SupabaseClient<Database>>();
    if (!document.labels) {
      throw new Error("No labels provided");
    }

    return client
      .from("documentLabel")
      .delete()
      .eq("documentId", document.documentId)
      .eq("userId", userId)
      .then(() => {
        return client.from("documentLabel").insert(
          // @ts-ignore
          document.labels.map((label) => ({
            documentId: document.documentId,
            label,
            userId: userId
          }))
        );
      });
  }
);
