/**
 * Server-only Certificate of Conformance work: rendering, issuing (one Kysely
 * transaction) and emailing. NOT exported from the module barrel — it imports
 * the PDF renderer, the job queue and server-only clients.
 */
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import { getCompanyTimeZone } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { getNextSequence } from "@carbon/database/sequence";
import { CertificateOfConformanceEmail } from "@carbon/documents/email";
import type { CertificateOfConformanceHeader } from "@carbon/documents/pdf";
import { CertificateOfConformancePDF, ensureFont } from "@carbon/documents/pdf";
import {
  collectSectionIds,
  resolveTemplate,
  toDocumentTemplate
} from "@carbon/documents/template";
import { withRevisionSuffix } from "@carbon/documents/utils";
import { getDocumentType, storage } from "@carbon/files";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import { datetime } from "@carbon/utils";
import { renderAsync } from "@react-email/components";
import { renderToStream } from "@react-pdf/renderer";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getEmployeeJob } from "~/modules/people";
import { getCustomerContact } from "~/modules/sales";
import {
  getCompany,
  getDocumentTemplate,
  resolveSections
} from "~/modules/settings";
import { getUser } from "~/modules/users/users.server";
import { stripSpecialCharacters } from "~/utils/string";
import type { CertificateOfConformanceShipmentData } from "./inventory.service";
import {
  getCertificateOfConformanceData,
  getCertificatesOfConformance
} from "./inventory.service";

const logger = getLogger("erp", "inventory", "certificate-of-conformance");

type Result<T> =
  | { data: T; error: null }
  | { data: null; error: { message: string } };

function failure<T>(
  message: string,
  context: Record<string, unknown> = {}
): Result<T> {
  logger.error(message, context);
  return { data: null, error: { message } };
}

/** A PDF's bytes, backed by a plain ArrayBuffer so a `Response` accepts it. */
type PdfBytes = Uint8Array<ArrayBuffer>;

async function streamToBytes(stream: NodeJS.ReadableStream): Promise<PdfBytes> {
  const body: Buffer = await new Promise((resolve, reject) => {
    const buffers: Uint8Array[] = [];
    stream.on("data", (chunk) => buffers.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(buffers)));
    stream.on("error", reject);
  });
  const bytes = new Uint8Array(body.byteLength);
  bytes.set(body);
  return bytes;
}

/** The signer snapshot for field 14: the user's name and job title. */
async function getSigner(
  client: SupabaseClient<Database>,
  companyId: string,
  userId: string
) {
  const [user, job] = await Promise.all([
    getUser(client, userId),
    getEmployeeJob(client, userId, companyId)
  ]);
  if (user.error || !user.data) return null;
  const name =
    user.data.fullName ||
    `${user.data.firstName} ${user.data.lastName}`.trim() ||
    user.data.email;
  return { name, title: job.data?.title ?? null };
}

type RenderArgs = {
  companyId: string;
  shipmentId: string;
  locale: string;
  certificate: CertificateOfConformanceHeader;
};

/**
 * Render a shipment's certificate. `certificate` decides preview vs issued:
 * an unissued header prints the PREVIEW watermark.
 */
export async function renderCertificateOfConformancePdf(
  client: SupabaseClient<Database>,
  args: RenderArgs
): Promise<Result<PdfBytes>> {
  const rendered = await renderCertificate(client, args);
  return rendered.error ? rendered : { data: rendered.data.pdf, error: null };
}

async function renderCertificate(
  client: SupabaseClient<Database>,
  args: RenderArgs
): Promise<
  Result<{ pdf: PdfBytes; content: CertificateOfConformanceShipmentData }>
> {
  const { companyId, shipmentId, locale, certificate } = args;

  const [company, content, storedTemplate] = await Promise.all([
    getCompany(client, companyId),
    getCertificateOfConformanceData(client, companyId, shipmentId, {
      locale,
      reasonForUpdate: certificate.reasonForUpdate
    }),
    getDocumentTemplate(client, companyId, "certificateOfConformance")
  ]);

  if (company.error || !company.data) {
    return failure("Failed to load company", {
      companyId,
      error: company.error
    });
  }
  if (content.error) {
    return failure(content.error.message, { companyId, shipmentId });
  }
  if (storedTemplate.error) {
    return failure("Failed to load the certificate template", {
      companyId,
      error: storedTemplate.error
    });
  }

  const template = toDocumentTemplate(
    storedTemplate.data,
    "certificateOfConformance"
  );
  const resolved = resolveTemplate("certificateOfConformance", template);
  const sections = await resolveSections(
    client,
    companyId,
    collectSectionIds(resolved)
  );
  await ensureFont(resolved.settings.fontFamily);

  try {
    const stream = await renderToStream(
      <CertificateOfConformancePDF
        // The companies-view shape the documents package types against; the
        // table row carries every column it reads (same as the packing slip).
        company={company.data as any}
        locale={locale}
        certificate={certificate}
        customer={content.data.customer}
        purchaseOrderNumber={content.data.purchaseOrderNumber}
        lines={content.data.lines}
        conformity={content.data.conformity}
        template={template}
        sections={sections}
      />
    );
    return {
      data: { pdf: await streamToBytes(stream), content: content.data },
      error: null
    };
  } catch (error) {
    return failure("Failed to render the certificate of conformance", {
      companyId,
      shipmentId,
      error
    });
  }
}

/**
 * The header of a live preview: the number the certificate has (or will
 * keep on reissue), today, and the viewing user as the would-be signer.
 */
export async function getCertificateOfConformancePreviewHeader(
  client: SupabaseClient<Database>,
  args: { companyId: string; shipmentId: string; userId: string }
): Promise<CertificateOfConformanceHeader> {
  const [issued, signer, timeZone] = await Promise.all([
    getCertificatesOfConformance(client, args.companyId, args.shipmentId),
    getSigner(client, args.companyId, args.userId),
    getCompanyTimeZone(client, args.companyId)
  ]);
  if (issued.error) {
    logger.error("Failed to load issued certificates", {
      shipmentId: args.shipmentId,
      error: issued.error
    });
  }
  const latest = issued.data?.[0];
  return {
    number: latest
      ? withRevisionSuffix(latest.certificateId, latest.revision)
      : "Not issued",
    date: datetime.today(timeZone).toString(),
    issued: false,
    reasonForUpdate: null,
    signer
  };
}

export type IssuedCertificateOfConformance = {
  id: string;
  certificateId: string;
  revision: number;
  number: string;
};

/**
 * Issue a certificate for a Posted shipment: revision 0 draws a new COC
 * number; a reissue keeps the number, takes revision n+1 and requires a
 * reason. Sequence, render, upload, `document` and `certificateOfConformance`
 * run in one transaction; an uploaded object is removed if anything after it
 * fails.
 */
export async function issueCertificateOfConformance(
  db: Kysely<KyselyDatabase>,
  client: SupabaseClient<Database>,
  args: {
    companyId: string;
    shipmentId: string;
    userId: string;
    reasonForUpdate?: string | null;
    locale: string;
  }
): Promise<Result<IssuedCertificateOfConformance>> {
  const { companyId, shipmentId, userId, locale } = args;
  const reasonForUpdate = args.reasonForUpdate?.trim() || null;

  const shipment = await client
    .from("shipment")
    .select("id, status, customerId")
    .eq("id", shipmentId)
    .eq("companyId", companyId)
    .maybeSingle();
  if (shipment.error) {
    return failure("Failed to load shipment", {
      shipmentId,
      error: shipment.error
    });
  }
  if (!shipment.data) {
    return failure("Shipment not found", { shipmentId, companyId });
  }
  if (shipment.data.status !== "Posted") {
    return failure("Only posted shipments can be certified", {
      shipmentId,
      status: shipment.data.status
    });
  }

  const [signer, timeZone] = await Promise.all([
    getSigner(client, companyId, userId),
    getCompanyTimeZone(client, companyId)
  ]);
  if (!signer) {
    return failure("Failed to load the signing user", { userId });
  }

  const signedAt = datetime.timestamp();
  const date = datetime.today(timeZone).toString();
  const companyStorage = storage(client).company(companyId);
  let uploadedPath: string | null = null;

  try {
    const issued = await db.transaction().execute(async (trx) => {
      // Serialise issues of one shipment, so two clicks cannot mint two
      // numbers or collide on a revision.
      await trx
        .selectFrom("shipment")
        .select("id")
        .where("id", "=", shipmentId)
        .where("companyId", "=", companyId)
        .forUpdate()
        .executeTakeFirstOrThrow();

      const latest = await trx
        .selectFrom("certificateOfConformance")
        .select(["certificateId", "revision"])
        .where("shipmentId", "=", shipmentId)
        .where("companyId", "=", companyId)
        .orderBy("revision", "desc")
        .limit(1)
        .executeTakeFirst();

      if (latest && !reasonForUpdate) {
        throw new Error("A reason is required to reissue");
      }

      const certificateId = latest
        ? latest.certificateId
        : await getNextSequence(trx, "certificateOfConformance", companyId);
      const revision = latest ? latest.revision + 1 : 0;
      const number = withRevisionSuffix(certificateId, revision);

      const rendered = await renderCertificate(client, {
        companyId,
        shipmentId,
        locale,
        certificate: {
          number,
          date,
          issued: true,
          reasonForUpdate: revision > 0 ? reasonForUpdate : null,
          signer
        }
      });
      if (rendered.error) throw new Error(rendered.error.message);
      const { pdf, content } = rendered.data;

      const fileName = `${stripSpecialCharacters(number) || "certificate"}.pdf`;
      const path = `${companyId}/shipment/${shipmentId}/${fileName}`;
      const upload = await companyStorage.upload(path, pdf, {
        cacheControl: `${12 * 60 * 60}`,
        contentType: "application/pdf",
        upsert: false
      });
      if (upload.error) {
        throw new Error(
          `Failed to store the certificate: ${upload.error.message}`
        );
      }
      uploadedPath = path;

      const document = await trx
        .insertInto("document")
        .values({
          name: fileName,
          path,
          // KB, as every other document row stores it.
          size: Math.round(pdf.byteLength / 1024),
          type: getDocumentType(fileName),
          sourceDocument: "Shipment",
          sourceDocumentId: shipmentId,
          readGroups: [userId],
          writeGroups: [userId],
          companyId,
          createdBy: userId
        })
        .returning("id")
        .executeTakeFirstOrThrow();

      const certificate = await trx
        .insertInto("certificateOfConformance")
        .values({
          certificateId,
          revision,
          shipmentId,
          customerId: content.shipment.customerId,
          reasonForUpdate: revision > 0 ? reasonForUpdate : null,
          documentId: document.id,
          signedBy: userId,
          signedByName: signer.name,
          signedByTitle: signer.title,
          signedAt,
          companyId,
          createdBy: userId
        })
        .returning("id")
        .executeTakeFirstOrThrow();

      return { id: certificate.id, certificateId, revision, number };
    });

    return { data: issued, error: null };
  } catch (error) {
    if (uploadedPath) {
      const removed = await companyStorage.remove([uploadedPath]);
      if (removed.error) {
        logger.error("Failed to remove an orphaned certificate PDF", {
          path: uploadedPath,
          error: removed.error
        });
      }
    }
    const message =
      error instanceof Error
        ? error.message
        : "Failed to issue the certificate of conformance";
    return failure(message, { shipmentId, companyId, error });
  }
}

/**
 * The stored PDF of an issued revision — the record, never re-rendered. The
 * `document` row's read groups are the issuer's, so its path is read with the
 * service role, scoped to the certificate's own document and company, after
 * the caller's client has proven it can see the certificate.
 */
export async function getIssuedCertificateOfConformancePdf(
  client: SupabaseClient<Database>,
  args: { companyId: string; shipmentId: string; revision: number }
): Promise<Result<{ bytes: PdfBytes; fileName: string }>> {
  const certificate = await client
    .from("certificateOfConformance")
    .select("certificateId, revision, documentId")
    .eq("shipmentId", args.shipmentId)
    .eq("revision", args.revision)
    .eq("companyId", args.companyId)
    .maybeSingle();
  if (certificate.error) {
    return failure("Failed to load the certificate", {
      ...args,
      error: certificate.error
    });
  }
  if (!certificate.data?.documentId) {
    return failure("Certificate not found", args);
  }

  const path = await getCertificateDocumentPath(
    args.companyId,
    certificate.data.documentId
  );
  if (path.error) return path;

  const file = await storage(getCarbonServiceRole())
    .company(args.companyId)
    .download(path.data);
  if (file.error || !file.data) {
    return failure("Failed to download the certificate", {
      path: path.data,
      error: file.error
    });
  }

  return {
    data: {
      bytes: new Uint8Array(await file.data.arrayBuffer()),
      fileName: `${withRevisionSuffix(
        certificate.data.certificateId,
        certificate.data.revision
      )}.pdf`
    },
    error: null
  };
}

async function getCertificateDocumentPath(
  companyId: string,
  documentId: string
): Promise<Result<string>> {
  const document = await getCarbonServiceRole()
    .from("document")
    .select("path")
    .eq("id", documentId)
    .eq("companyId", companyId)
    .maybeSingle();
  if (document.error || !document.data) {
    return failure("Failed to load the certificate document", {
      documentId,
      error: document.error
    });
  }
  return { data: document.data.path, error: null };
}

/**
 * Email an issued revision's stored PDF to a customer contact (and the
 * sender), then stamp `lastSentAt` / `lastSentTo`.
 */
export async function sendCertificateOfConformance(
  client: SupabaseClient<Database>,
  args: {
    companyId: string;
    shipmentId: string;
    userId: string;
    certificateOfConformanceId: string;
    customerContactId: string;
    cc?: string[];
    locale: string;
  }
): Promise<Result<{ to: string[] }>> {
  const { companyId, userId, certificateOfConformanceId, locale } = args;

  const certificate = await client
    .from("certificateOfConformance")
    .select("id, certificateId, revision, shipmentId, customerId, documentId")
    .eq("id", certificateOfConformanceId)
    .eq("shipmentId", args.shipmentId)
    .eq("companyId", companyId)
    .maybeSingle();
  if (certificate.error) {
    return failure("Failed to load the certificate", {
      certificateOfConformanceId,
      error: certificate.error
    });
  }
  if (!certificate.data?.documentId) {
    return failure("Certificate not found", { certificateOfConformanceId });
  }

  const [contact, sender, company, content] = await Promise.all([
    getCustomerContact(client, args.customerContactId, companyId),
    getUser(client, userId),
    getCompany(client, companyId),
    getCertificateOfConformanceData(
      client,
      companyId,
      certificate.data.shipmentId,
      { locale }
    )
  ]);

  if (contact.error || !contact.data) {
    return failure("Customer contact not found", {
      customerContactId: args.customerContactId,
      error: contact.error
    });
  }
  if (
    certificate.data.customerId &&
    contact.data.customerId !== certificate.data.customerId
  ) {
    return failure("The selected contact does not belong to this customer", {
      customerContactId: args.customerContactId
    });
  }
  const contactEmail = contact.data.contact?.email;
  if (!contactEmail) {
    return failure("The selected contact has no email address", {
      customerContactId: args.customerContactId
    });
  }
  if (sender.error || !sender.data) {
    return failure("Failed to load the sending user", {
      userId,
      error: sender.error
    });
  }
  if (company.error || !company.data) {
    return failure("Failed to load company", { error: company.error });
  }
  if (content.error) {
    return failure(content.error.message, {
      shipmentId: certificate.data.shipmentId
    });
  }

  // The stored PDF is the record: never re-render.
  const path = await getCertificateDocumentPath(
    companyId,
    certificate.data.documentId
  );
  if (path.error) return path;
  const signed = await storage(getCarbonServiceRole())
    .company(companyId)
    .createSignedUrl(path.data, 3600);
  if (signed.error || !signed.data) {
    return failure("Failed to prepare the certificate attachment", {
      path: path.data,
      error: signed.error
    });
  }

  const number = withRevisionSuffix(
    certificate.data.certificateId,
    certificate.data.revision
  );
  const shipmentReadableId = content.data.shipment.shipmentId;

  const email = CertificateOfConformanceEmail({
    // Same row-for-view cast as the PDF above.
    company: company.data as any,
    locale,
    certificateNumber: number,
    shipmentId: shipmentReadableId,
    customerPurchaseOrder: content.data.purchaseOrderNumber,
    lines: content.data.lines.map((line) => ({
      itemNumber: line.itemNumber,
      description: line.description,
      quantity: line.quantity
    })),
    recipient: {
      email: contactEmail,
      firstName: contact.data.contact?.firstName ?? undefined,
      lastName: contact.data.contact?.lastName ?? undefined
    },
    sender: {
      email: sender.data.email,
      firstName: sender.data.firstName,
      lastName: sender.data.lastName
    }
  });

  const to = [...new Set([sender.data.email, contactEmail])];
  try {
    const [html, text] = await Promise.all([
      renderAsync(email),
      renderAsync(email, { plainText: true })
    ]);
    await trigger("send-email", {
      to,
      cc: args.cc?.length ? args.cc : undefined,
      from: sender.data.email,
      subject: `Certificate of Conformance ${number} for ${shipmentReadableId} from ${company.data.name}`,
      html,
      text,
      attachments: [{ path: signed.data.signedUrl, filename: `${number}.pdf` }],
      companyId
    });
  } catch (error) {
    return failure("Failed to send the certificate email", {
      certificateOfConformanceId,
      error
    });
  }

  const stamped = await client
    .from("certificateOfConformance")
    .update({
      lastSentAt: datetime.timestamp(),
      lastSentTo: [contactEmail, ...(args.cc ?? [])],
      updatedBy: userId,
      updatedAt: datetime.timestamp()
    })
    .eq("id", certificateOfConformanceId)
    .eq("companyId", companyId);
  if (stamped.error) {
    // The email is already queued; a missing stamp is not worth failing it.
    logger.error("Failed to record the certificate send", {
      certificateOfConformanceId,
      error: stamped.error
    });
  }

  return { data: { to: [contactEmail] }, error: null };
}
