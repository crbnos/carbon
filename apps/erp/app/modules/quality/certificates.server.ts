import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { getDocumentType, storage } from "@carbon/files";
import { getLogger } from "@carbon/logger";
import type { SupabaseClient } from "@supabase/supabase-js";

const logger = getLogger("erp", "certificates");

type Result<T> =
  | { data: T; error: null }
  | { data: null; error: { message: string } };

type CertificateType = Database["public"]["Enums"]["certificateType"];

/**
 * A supplier certificate on a received line, with its uploaded file, in one
 * transaction: the `document` row and the `certificate` row land together or
 * not at all. The file was uploaded by the browser before the post; when the
 * write fails it is removed again, unless another document already points at
 * the same path (the upload overwrites a same-named file).
 *
 * `supplierId` comes from the form and Kysely bypasses RLS, so a supplier that
 * is not this company's is dropped rather than written.
 */
export async function addReceiptLineCertificate(
  db: Kysely<KyselyDatabase>,
  client: SupabaseClient<Database>,
  args: {
    companyId: string;
    userId: string;
    receiptLineId: string;
    receiptId: string;
    certificate: {
      type: CertificateType;
      certificateNumber: string;
      specification?: string;
      notes?: string;
      supplierId?: string;
    };
    upload?: { path: string; name: string; size: number };
  }
): Promise<Result<{ id: string }>> {
  const { companyId, userId, receiptLineId, receiptId, certificate, upload } =
    args;

  try {
    const id = await db.transaction().execute(async (trx) => {
      const supplier = certificate.supplierId
        ? await trx
            .selectFrom("supplier")
            .select(["id"])
            .where("id", "=", certificate.supplierId)
            .where("companyId", "=", companyId)
            .executeTakeFirst()
        : undefined;

      let documentId: string | null = null;
      if (upload) {
        const document = await trx
          .insertInto("document")
          .values({
            path: upload.path,
            name: upload.name,
            // KB, as every other document row stores it.
            size: upload.size,
            type: getDocumentType(upload.name),
            sourceDocument: "Receipt",
            sourceDocumentId: receiptId,
            readGroups: [userId],
            writeGroups: [userId],
            companyId,
            createdBy: userId
          })
          .returning(["id"])
          .executeTakeFirstOrThrow();
        documentId = document.id;
      }

      const inserted = await trx
        .insertInto("certificate")
        .values({
          type: certificate.type,
          certificateNumber: certificate.certificateNumber,
          specification: certificate.specification ?? null,
          notes: certificate.notes ?? null,
          supplierId: supplier?.id ?? null,
          receiptLineId,
          documentId,
          companyId,
          createdBy: userId
        })
        .returning(["id"])
        .executeTakeFirstOrThrow();
      return inserted.id;
    });

    return { data: { id }, error: null };
  } catch (err) {
    logger.error("Failed to add a receipt line certificate", {
      error: err,
      companyId,
      receiptLineId
    });
    if (upload) await removeOrphanedUpload(db, client, companyId, upload.path);
    return {
      data: null,
      error: {
        message:
          err instanceof Error ? err.message : "Failed to add certificate"
      }
    };
  }
}

async function removeOrphanedUpload(
  db: Kysely<KyselyDatabase>,
  client: SupabaseClient<Database>,
  companyId: string,
  path: string
) {
  try {
    const referenced = await db
      .selectFrom("document")
      .select(["id"])
      .where("path", "=", path)
      .where("companyId", "=", companyId)
      .executeTakeFirst();
    if (referenced) return;

    const removed = await storage(client).company(companyId).remove([path]);
    if (removed.error) {
      logger.error("Failed to remove an orphaned certificate upload", {
        error: removed.error,
        companyId,
        path
      });
    }
  } catch (err) {
    logger.error("Failed to remove an orphaned certificate upload", {
      error: err,
      companyId,
      path
    });
  }
}

/**
 * Deletes a certificate of one receipt line. The id comes from the client, so
 * the delete is scoped to the line and fails when it matched nothing.
 */
export async function deleteReceiptLineCertificate(
  db: Kysely<KyselyDatabase>,
  args: { id: string; receiptLineId: string; companyId: string }
): Promise<Result<{ id: string }>> {
  try {
    const deleted = await db
      .deleteFrom("certificate")
      .where("id", "=", args.id)
      .where("receiptLineId", "=", args.receiptLineId)
      .where("companyId", "=", args.companyId)
      .returning(["id"])
      .executeTakeFirst();
    if (!deleted) {
      return { data: null, error: { message: "Certificate not found" } };
    }
    return { data: { id: deleted.id }, error: null };
  } catch (err) {
    logger.error("Failed to delete a receipt line certificate", {
      error: err,
      ...args
    });
    return {
      data: null,
      error: {
        message:
          err instanceof Error ? err.message : "Failed to delete certificate"
      }
    };
  }
}
