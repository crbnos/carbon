import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
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
      `description.ilike.%${args.search}%,sourceDocumentReadableId.ilike.%${args.search}%`
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
  const update: Record<string, unknown> = {
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
    .select(
      "id, locationId, name, format, mediaSizeId, printerUrl, apiKey, templateId"
    )
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
    apiKey?: string | null;
    templateId?: string | null;
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
        apiKey: route.apiKey ?? null,
        templateId: route.templateId ?? null,
        updatedAt: new Date().toISOString()
      })
      .eq("id", route.id)
      .eq("companyId", route.companyId);
  }

  return client.from("printerRoute").insert({
    companyId: route.companyId,
    locationId: route.locationId ?? null,
    name: route.name,
    format: route.format,
    mediaSizeId: route.mediaSizeId ?? null,
    printerUrl: route.printerUrl,
    apiKey: route.apiKey ?? null,
    templateId: route.templateId ?? null
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
