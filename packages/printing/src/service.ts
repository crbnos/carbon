// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { datetime, searchFilter } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LabelTemplateType } from "./registry";
import type {
  PrinterRoute,
  PrintingSettings,
  PrintJobContentType,
  PrintJobOrigin,
  PrintJobStatus
} from "./types";

// -- Print Jobs --

export async function getPrintJobs(
  client: SupabaseClient<Database>,
  companyId: string,
  args?: {
    status?: string;
    origin?: string;
    sourceDocument?: string;
    contentType?: string;
    search?: string | null;
    limit?: number;
    offset?: number;
  }
) {
  let query = client
    .from("printJob")
    .select(
      "id, companyId, status, contentType, printerUrl, sourceDocument, sourceDocumentId, sourceDocumentReadableId, description, origin, error, attempts, createdBy, createdAt, updatedAt, updatedBy, completedAt",
      { count: "exact" }
    )
    .eq("companyId", companyId)
    .order("createdAt", { ascending: false });

  if (args?.status) {
    query = query.eq("status", args.status);
  }

  if (args?.origin) {
    query = query.eq("origin", args.origin);
  }

  if (args?.sourceDocument) {
    query = query.eq("sourceDocument", args.sourceDocument);
  }

  if (args?.contentType) {
    query = query.eq("contentType", args.contentType);
  }

  if (args?.search) {
    query = query.or(
      searchFilter(["description", "sourceDocumentReadableId"], args.search)
    );
  }

  const limit = args?.limit ?? 100;
  const offset = args?.offset ?? 0;
  query = query.range(offset, offset + limit - 1);

  return query;
}

export async function getPrintJob(
  client: SupabaseClient<Database>,
  printJobId: string,
  companyId: string
) {
  return client
    .from("printJob")
    .select(
      "id, companyId, status, contentType, printerUrl, sourceDocument, sourceDocumentId, sourceDocumentReadableId, description, origin, error, attempts, createdBy, createdAt, updatedAt, updatedBy, completedAt"
    )
    .eq("id", printJobId)
    .eq("companyId", companyId)
    .single();
}

export async function getPrintJobContent(
  client: SupabaseClient<Database>,
  printJobId: string,
  companyId: string
) {
  return client
    .from("printJob")
    .select("id, content, contentType")
    .eq("id", printJobId)
    .eq("companyId", companyId)
    .single();
}

export async function createPrintJob(
  client: SupabaseClient<Database>,
  job: {
    companyId: string;
    contentType?: PrintJobContentType;
    content?: string;
    printerUrl: string;
    sourceDocument: string;
    sourceDocumentId: string;
    sourceDocumentReadableId?: string;
    description: string;
    status?: PrintJobStatus;
    origin?: PrintJobOrigin;
    createdBy: string;
  }
) {
  return client
    .from("printJob")
    .insert({
      companyId: job.companyId,
      contentType: job.contentType ?? null,
      content: job.content ?? null,
      printerUrl: job.printerUrl,
      sourceDocument: job.sourceDocument,
      sourceDocumentId: job.sourceDocumentId,
      sourceDocumentReadableId: job.sourceDocumentReadableId,
      description: job.description,
      status: job.status ?? "generating",
      origin: job.origin ?? "auto",
      createdBy: job.createdBy
    })
    .select("id")
    .single();
}

export async function updatePrintJobContent(
  client: SupabaseClient<Database>,
  printJobId: string,
  companyId: string,
  content: string,
  contentType: PrintJobContentType
) {
  return client
    .from("printJob")
    .update({
      content,
      contentType,
      status: "queued",
      updatedAt: new Date().toISOString()
    })
    .eq("id", printJobId)
    .eq("companyId", companyId);
}

export async function updatePrintJobStatus(
  client: SupabaseClient<Database>,
  printJobId: string,
  companyId: string,
  status: PrintJobStatus,
  opts?: { error?: string }
) {
  const update: Database["public"]["Tables"]["printJob"]["Update"] = {
    status,
    updatedAt: new Date().toISOString()
  };

  if (status === "failed") {
    update.error = opts?.error ?? null;
  } else {
    update.error = null;
  }

  if (status === "completed") {
    update.completedAt = new Date().toISOString();
  }

  return client
    .from("printJob")
    .update(update)
    .eq("id", printJobId)
    .eq("companyId", companyId);
}

// -- Printer Routes --

export async function getPrinterRoutes(
  client: SupabaseClient<Database>,
  companyId: string
) {
  const result = await client
    .from("printerRoute")
    .select("*")
    .eq("companyId", companyId)
    .order("name");

  return {
    ...result,
    // "format" is text in the DB but constrained to 'zpl' | 'pdf' by a CHECK
    data: result.data as PrinterRoute[] | null
  };
}

export async function getPrinterRoute(
  client: SupabaseClient<Database>,
  routeId: string,
  companyId: string
) {
  return client
    .from("printerRoute")
    .select("id, locationId, name, format, mediaSizeId, printerUrl, hasApiKey")
    .eq("id", routeId)
    .eq("companyId", companyId)
    .single();
}

export async function upsertPrinterRoute(
  client: SupabaseClient<Database>,
  route: {
    id?: string;
    companyId: string;
    locationId?: string | null;
    name: string;
    format: string;
    mediaSizeId?: string | null;
    printerUrl: string;
  }
) {
  if (route.id) {
    return client
      .from("printerRoute")
      .update({
        locationId: route.locationId ?? null,
        name: route.name,
        format: route.format,
        mediaSizeId: route.mediaSizeId ?? null,
        printerUrl: route.printerUrl,
        updatedAt: new Date().toISOString()
      })
      .eq("id", route.id)
      .eq("companyId", route.companyId)
      .select("id")
      .single();
  }

  return client
    .from("printerRoute")
    .insert({
      companyId: route.companyId,
      locationId: route.locationId ?? null,
      name: route.name,
      format: route.format,
      mediaSizeId: route.mediaSizeId ?? null,
      printerUrl: route.printerUrl
    })
    .select("id")
    .single();
}

/**
 * Sets, replaces or (with null) removes a printer's API key, kept in Supabase
 * Vault and flagged by `printerRoute.hasApiKey`. Needs the service role client.
 */
export async function setPrinterApiKey(
  client: SupabaseClient<Database>,
  companyId: string,
  printerRouteId: string,
  apiKey: string | null
) {
  return client.rpc("set_printer_api_key", {
    p_company_id: companyId,
    p_printer_route_id: printerRouteId,
    p_api_key: apiKey ?? ""
  });
}

/** A printer's API key from Supabase Vault. Needs the service role client. */
export async function getPrinterApiKey(
  client: SupabaseClient<Database>,
  companyId: string,
  printerRouteId: string
) {
  return client.rpc("get_printer_api_key", {
    p_company_id: companyId,
    p_printer_route_id: printerRouteId
  });
}

export async function deletePrinterRoute(
  client: SupabaseClient<Database>,
  routeId: string,
  companyId: string
) {
  return client
    .from("printerRoute")
    .delete()
    .eq("id", routeId)
    .eq("companyId", companyId)
    .select("id");
}

// -- Label Templates --

export async function getLabelTemplates(
  client: SupabaseClient<Database>,
  companyId: string
) {
  // "labelType" is text in the DB, constrained to the label types by a CHECK.
  return client
    .from("labelTemplate")
    .select("id, labelType, mediaSizeId, templateId")
    .eq("companyId", companyId)
    .order("labelType")
    .order("mediaSizeId")
    .overrideTypes<{ labelType: LabelTemplateType }[]>();
}

/** The company's BinderyPress template per label type for one media size. */
export async function getLabelTemplatesForMediaSize(
  client: SupabaseClient<Database>,
  companyId: string,
  mediaSizeId: string
): Promise<Map<LabelTemplateType, string>> {
  const { data, error } = await client
    .from("labelTemplate")
    .select("labelType, templateId")
    .eq("companyId", companyId)
    .eq("mediaSizeId", mediaSizeId);
  if (error)
    throw new Error(`Failed to load label templates: ${error.message}`);
  return new Map(
    data.map((row) => [row.labelType as LabelTemplateType, row.templateId])
  );
}

export async function upsertLabelTemplate(
  client: SupabaseClient<Database>,
  template: {
    id?: string;
    companyId: string;
    userId: string;
    labelType: LabelTemplateType;
    mediaSizeId: string;
    templateId: string;
  }
) {
  const { id, companyId, userId, ...fields } = template;
  if (id) {
    return client
      .from("labelTemplate")
      .update({
        ...fields,
        updatedBy: userId,
        updatedAt: datetime.timestamp()
      })
      .eq("id", id)
      .eq("companyId", companyId);
  }
  return client
    .from("labelTemplate")
    .insert({ ...fields, companyId, createdBy: userId });
}

export async function deleteLabelTemplate(
  client: SupabaseClient<Database>,
  id: string,
  companyId: string
) {
  return client
    .from("labelTemplate")
    .delete()
    .eq("id", id)
    .eq("companyId", companyId);
}

// -- Printing Settings --

export async function getPrintingSettings(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("companySettings")
    .select("printing")
    .eq("id", companyId)
    .single();
}

export async function updatePrintingSettings(
  client: SupabaseClient<Database>,
  companyId: string,
  settings: PrintingSettings
) {
  return client
    .from("companySettings")
    .update({
      printing:
        settings as unknown as Database["public"]["Tables"]["companySettings"]["Update"]["printing"]
    })
    .eq("id", companyId);
}
