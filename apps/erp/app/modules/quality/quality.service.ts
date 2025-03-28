import type { Database, Json } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import type { GenericQueryFilters } from "~/utils/query";
import { setGenericQueryFilters } from "~/utils/query";
import { sanitize } from "~/utils/supabase";
import type {
  nonConformanceTemplateValidator,
  nonConformanceTypeValidator,
} from "./quality.models";

export async function deleteNonConformanceType(
  client: SupabaseClient<Database>,
  nonConformanceTypeId: string
) {
  return client
    .from("nonConformanceType")
    .delete()
    .eq("id", nonConformanceTypeId);
}

export async function deleteNonConformanceTemplate(
  client: SupabaseClient<Database>,
  nonConformanceTemplateId: string
) {
  return client
    .from("nonConformanceTemplate")
    .delete()
    .eq("id", nonConformanceTemplateId);
}

export async function getNonConformanceTemplate(
  client: SupabaseClient<Database>,
  nonConformanceTemplateId: string
) {
  return client
    .from("nonConformanceTemplate")
    .select("*")
    .eq("id", nonConformanceTemplateId)
    .single();
}

export async function getNonConformanceTemplates(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("nonConformanceTemplate")
    .select("*", { count: "exact" })
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "name", ascending: true },
    ]);
  }

  return query;
}

export async function getNonConformanceTypesList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("nonConformanceType")
    .select("id, name")
    .eq("companyId", companyId)
    .order("name");
}

export async function getNonConformanceType(
  client: SupabaseClient<Database>,
  nonConformanceTypeId: string
) {
  return client
    .from("nonConformanceType")
    .select("*")
    .eq("id", nonConformanceTypeId)
    .single();
}

export async function getNonConformanceTypes(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: GenericQueryFilters & { search: string | null }
) {
  let query = client
    .from("nonConformanceType")
    .select("id, name", { count: "exact" })
    .eq("companyId", companyId);

  if (args?.search) {
    query = query.ilike("name", `%${args.search}%`);
  }

  if (args) {
    query = setGenericQueryFilters(query, args, [
      { column: "name", ascending: true },
    ]);
  }

  return query;
}

export async function upsertNonConformanceTemplate(
  client: SupabaseClient<Database>,
  nonConformanceTemplate:
    | (Omit<z.infer<typeof nonConformanceTemplateValidator>, "id"> & {
        companyId: string;
        createdBy: string;
      })
    | (Omit<z.infer<typeof nonConformanceTemplateValidator>, "id"> & {
        id: string;
        updatedBy: string;
      })
) {
  if ("createdBy" in nonConformanceTemplate) {
    return client
      .from("nonConformanceTemplate")
      .insert([nonConformanceTemplate])
      .select("id")
      .single();
  } else {
    return client
      .from("nonConformanceTemplate")
      .update(sanitize(nonConformanceTemplate))
      .eq("id", nonConformanceTemplate.id);
  }
}

export async function upsertNonConformanceType(
  client: SupabaseClient<Database>,
  nonConformanceType:
    | (Omit<z.infer<typeof nonConformanceTypeValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof nonConformanceTypeValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in nonConformanceType) {
    return client
      .from("nonConformanceType")
      .insert([nonConformanceType])
      .select("id");
  } else {
    return client
      .from("nonConformanceType")
      .update(sanitize(nonConformanceType))
      .eq("id", nonConformanceType.id);
  }
}
