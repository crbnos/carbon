import type { Database } from "@carbon/database";
import { SalesOrderEmail } from "@carbon/documents/email";
import { trigger } from "@carbon/jobs";
import { redis } from "@carbon/kv";
import {
  createCompanyPrivateSignedUrl,
  getCompanyPrivateBucket
} from "@carbon/utils";
import type { CalendarDate } from "@internationalized/date";
import { startOfWeek } from "@internationalized/date";
import { renderAsync } from "@react-email/components";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LoaderFunctionArgs } from "react-router";
import { getPaymentTermsList } from "~/modules/accounting";
import {
  getCustomerContact,
  getSalesOrder,
  getSalesOrderCustomerDetails,
  getSalesOrderLines
} from "~/modules/sales";
import { getCompany } from "~/modules/settings";
import { getUser } from "~/modules/users/users.server";
import { getDatabaseClient } from "~/services/database.server";
import { stripSpecialCharacters } from "~/utils/string";
import { upsertDocument } from "../documents/documents.service";
import type { CustomFieldsTableType } from "../settings";

export async function assign(
  client: SupabaseClient<Database>,
  args: {
    id: string;
    table: string;
    assignee: string;
  }
) {
  const { id, table, assignee } = args;

  return (
    client
      // @ts-ignore
      .from(table)
      .update({ assignee: assignee ? assignee : null })
      .eq("id", id)
  );
}

export async function getCustomFieldsCacheKey(args?: {
  companyId?: string;
  module?: string;
  table?: string;
}) {
  return `customFields:${args?.companyId}:${args?.module ?? ""}:${
    args?.table ?? ""
  }`;
}

export async function getCustomFieldsSchemas(
  client: SupabaseClient<Database>,
  args?: {
    companyId: string;
    module?: string;
    table?: string;
  }
) {
  const key = await getCustomFieldsCacheKey(args);
  let schema: CustomFieldsTableType[] | null = null;

  try {
    const cachedSchema = await redis.get(key);
    if (cachedSchema) {
      schema = JSON.parse(cachedSchema) as CustomFieldsTableType[];
    }
  } finally {
    if (schema) {
      return {
        data: schema as CustomFieldsTableType[],
        error: null
      };
    }

    const query = client.from("customFieldTables").select("*");

    if (args?.companyId) {
      query.eq("companyId", args.companyId);
    }

    if (args?.module) {
      query.eq("module", args.module as any);
    }

    if (args?.table) {
      query.eq("table", args.table);
    }

    const result = await query;
    if (result.data) {
      await redis.set(key, JSON.stringify(result.data));
    }

    return result;
  }
}

/**
 * Generates a sales order PDF via the pdfLoader, uploads it to Supabase
 * storage under the opportunity path, and creates a document DB record.
 *
 * Returns the PDF ArrayBuffer (useful for email attachments) and the
 * generated file name.
 */
export async function generateAndAttachSalesOrderPdf(args: {
  /** The original action/loader args from the route */
  routeArgs: LoaderFunctionArgs;
  /** Sales order DB id */
  salesOrderId: string;
  /** Human-readable sales order identifier (e.g. "SO-0001") */
  salesOrderIdentifier: string;
  /** Opportunity the SO belongs to */
  opportunityId: string;
  companyId: string;
  userId: string;
  /** A service-role Supabase client for storage + DB writes */
  serviceRole: SupabaseClient<Database>;
  /** The pdf loader imported from the sales-order pdf route */
  pdfLoader: (args: LoaderFunctionArgs) => Promise<Response>;
}): Promise<{ file: ArrayBuffer; fileName: string; documentFilePath: string }> {
  const {
    routeArgs,
    salesOrderId,
    salesOrderIdentifier,
    opportunityId,
    companyId,
    userId,
    serviceRole,
    pdfLoader
  } = args;

  // 1. Generate the PDF
  const pdfArgs = {
    ...routeArgs,
    params: { ...routeArgs.params, id: salesOrderId }
  };
  const pdf = await pdfLoader(pdfArgs);

  if (pdf.headers.get("content-type") !== "application/pdf") {
    throw new Error("Failed to generate PDF");
  }

  const file = await pdf.arrayBuffer();
  const fileName = stripSpecialCharacters(
    `${salesOrderIdentifier} - ${new Date().toISOString().slice(0, -5)}.pdf`
  );

  // 2. Upload to Supabase storage
  const documentFilePath = `${companyId}/opportunity/${opportunityId}/${fileName}`;
  const companyPrivateBucket = getCompanyPrivateBucket(companyId);

  const uploadResult = await serviceRole.storage
    .from(companyPrivateBucket)
    .upload(documentFilePath, file, {
      cacheControl: `${12 * 60 * 60}`,
      contentType: "application/pdf",
      upsert: true
    });

  if (uploadResult.error) {
    throw new Error("Failed to upload PDF to storage");
  }

  // 3. Create the document DB record
  const documentResult = await upsertDocument(serviceRole, {
    path: documentFilePath,
    name: fileName,
    size: Math.round(file.byteLength / 1024),
    sourceDocument: "Sales Order",
    sourceDocumentId: salesOrderId,
    readGroups: [userId],
    writeGroups: [userId],
    createdBy: userId,
    companyId
  });

  if (documentResult.error) {
    throw new Error("Failed to create document record");
  }

  return { file, fileName, documentFilePath };
}

/**
 * Sends a sales order confirmation email with the PDF attached.
 *
 * This mirrors the email-sending logic originally in the confirm action
 * and can be reused by the quote-to-order conversion flow.
 */
export async function sendSalesOrderEmail(args: {
  salesOrderId: string;
  companyId: string;
  userId: string;
  customerContactId: string;
  cc?: string[];
  documentFilePath: string;
  fileName: string;
  serviceRole: SupabaseClient<Database>;
  locales: string[];
}): Promise<{ success: boolean; message?: string }> {
  const {
    salesOrderId,
    companyId,
    userId,
    customerContactId,
    cc: ccSelections,
    documentFilePath,
    fileName,
    serviceRole,
    locales
  } = args;

  const [
    company,
    customer,
    salesOrder,
    salesOrderLines,
    salesOrderLocations,
    seller,
    paymentTerms
  ] = await Promise.all([
    getCompany(serviceRole, companyId),
    getCustomerContact(serviceRole, customerContactId),
    getSalesOrder(serviceRole, salesOrderId),
    getSalesOrderLines(serviceRole, salesOrderId),
    getSalesOrderCustomerDetails(serviceRole, salesOrderId),
    getUser(serviceRole, userId),
    getPaymentTermsList(serviceRole, companyId)
  ]);

  if (!customer?.data?.contact) {
    return { success: false, message: "Failed to get customer contact" };
  }
  if (!company.data) {
    return { success: false, message: "Failed to get company" };
  }
  if (!seller.data) {
    return { success: false, message: "Failed to get user" };
  }
  if (!salesOrder.data) {
    return { success: false, message: "Failed to get sales order" };
  }
  if (!salesOrderLocations.data) {
    return { success: false, message: "Failed to get sales order locations" };
  }
  if (!paymentTerms.data) {
    return { success: false, message: "Failed to get payment terms" };
  }

  const emailTemplate = SalesOrderEmail({
    company: company.data as any,
    locale: locales?.[0] ?? "en-US",
    salesOrder: salesOrder.data,
    salesOrderLines: salesOrderLines.data ?? [],
    salesOrderLocations: salesOrderLocations.data,
    recipient: {
      email: customer.data.contact.email!,
      firstName: customer.data.contact.firstName ?? undefined,
      lastName: customer.data.contact.lastName ?? undefined
    },
    sender: {
      email: seller.data.email,
      firstName: seller.data.firstName,
      lastName: seller.data.lastName
    },
    paymentTerms: paymentTerms.data
  });

  const html = await renderAsync(emailTemplate);
  const text = await renderAsync(emailTemplate, { plainText: true });
  const signedUrlResult = await createCompanyPrivateSignedUrl({
    companyId,
    requestedBucket: getCompanyPrivateBucket(companyId),
    objectPath: documentFilePath,
    expiresIn: 3600,
    createSignedUrl: async (physicalBucket, objectPath, expiresIn) => {
      const { data, error } = await serviceRole.storage
        .from(physicalBucket)
        .createSignedUrl(objectPath, expiresIn);

      return {
        signedUrl: data?.signedUrl ?? null,
        error: error ?? null
      };
    }
  });

  for (const bucketError of signedUrlResult.errors) {
    console.error("Failed to create sales order attachment signed URL", {
      companyId,
      salesOrderId,
      documentFilePath,
      physicalBucket: bucketError.physicalBucket,
      error: bucketError.error
    });
  }

  await trigger("send-email", {
    to: [seller.data.email, customer.data.contact.email!],
    cc: ccSelections?.length ? ccSelections : undefined,
    from: seller.data.email,
    subject: `Order ${salesOrder.data.salesOrderId} from ${company.data.name}`,
    html,
    text,
    attachments: signedUrlResult.signedUrl
      ? [
          {
            path: signedUrlResult.signedUrl,
            filename: fileName
          }
        ]
      : undefined,
    companyId
  });

  return { success: true };
}

export async function getOrCreatePeriods(
  today: CalendarDate,
  weeksToProject: number
) {
  const start = startOfWeek(today, "en-US");

  // Generate weekly date ranges
  const ranges: { startDate: string; endDate: string }[] = [];
  let currentStart = start;
  for (let i = 0; i < weeksToProject; i++) {
    const periodEnd = currentStart.add({ days: 6 });
    ranges.push({
      startDate: currentStart.toString(),
      endDate: periodEnd.toString()
    });
    currentStart = periodEnd.add({ days: 1 });
  }

  const db = getDatabaseClient();

  // Check which periods already exist
  const existingPeriods = await db
    .selectFrom("period")
    .selectAll()
    .where(
      "startDate",
      "in",
      ranges.map((r) => r.startDate)
    )
    .where("periodType", "=", "Week")
    .execute();

  if (existingPeriods.length === ranges.length) {
    return existingPeriods.map(toPlainPeriod);
  }

  // Find missing periods
  const existingStartDates = new Set(
    existingPeriods.map((p) => dateToString(p.startDate))
  );

  const periodsToCreate = ranges.filter(
    (r) => !existingStartDates.has(r.startDate)
  );

  // Create missing periods in a transaction
  const created = await db.transaction().execute(async (trx) => {
    return await trx
      .insertInto("period")
      .values(
        periodsToCreate.map((p) => ({
          startDate: p.startDate,
          endDate: p.endDate,
          periodType: "Week" as const,
          createdAt: new Date().toISOString()
        }))
      )
      .returningAll()
      .execute();
  });

  return [...existingPeriods, ...created].map(toPlainPeriod);
}

/** Convert a pg DATE value (Date object or string) to an ISO date string. */
function dateToString(value: Date | string): string {
  if (value instanceof Date) {
    // Use local date parts to avoid timezone shift from toISOString()
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(value);
}

/** Return a plain JSON-safe object with only the fields consumers need. */
function toPlainPeriod(p: {
  id: string;
  startDate: Date | string;
  endDate: Date | string;
  periodType: string;
}) {
  return {
    id: String(p.id),
    startDate: dateToString(p.startDate),
    endDate: dateToString(p.endDate),
    periodType: p.periodType
  };
}
