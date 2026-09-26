import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import type { FirstArticleReason } from "@carbon/database/first-article";
import { resolveFirstArticleNeeds } from "@carbon/database/first-article";
import {
  createFirstArticleInspections,
  loadFirstArticleNeedInput
} from "@carbon/database/quality";
import { storage } from "@carbon/files";
import { getLogger } from "@carbon/logger";
import { datetime, stripSpecialCharacters } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";
import type { CertificationLineageRow } from "./certificationLineage";
import { renderFirstArticleInspectionPdf } from "./firstArticlePdf.server";
import type { firstArticleInspectionProductValidator } from "./quality.models";
import { getCertificationLineage } from "./quality.service";

const logger = getLogger("erp", "first-article");

type Result<T> =
  | { data: T; error: null }
  | { data: null; error: { message: string } };

function failure(err: unknown, fallback: string): Result<never> {
  return {
    data: null,
    error: { message: err instanceof Error ? err.message : fallback }
  };
}

const NO_CERTIFICATE = "No certificate on file";

// The FAI's job and make method are ON DELETE SET NULL: a deleted job, or Get
// Method rebuilding the sub-assembly, leaves the report without the operations
// and materials Form 2 and the verification read.
const MAKE_METHOD_GONE =
  "The job or make method of this first article no longer exists";

// AS9102 generation at release: every path that flips a job to Ready calls
// this AFTER the Ready write succeeds — `releaseJobs` (job Release dialog,
// batch and bulk release), the plain `status=Ready` post in
// `$jobId.status.tsx`, and the kanban auto-release. Not inside
// `updateJobStatus`: that is a `*.service.ts` function, which may not hold a
// Kysely client.
//
// Best-effort: a generation failure is logged and never undoes or blocks a
// release. The blocker (a required first article with no plan) is enforced
// BEFORE release by `getJobReleaseReadiness`; what can still fail here is
// infrastructure, and a missed lot can be created by hand from the job.
export async function afterJobsReleased(
  db: Kysely<KyselyDatabase>,
  client: SupabaseClient<Database>,
  {
    jobIds,
    companyId,
    userId
  }: { jobIds: string[]; companyId: string; userId: string }
): Promise<void> {
  if (jobIds.length === 0) return;

  let today: string;
  try {
    today = datetime
      .today(await getCompanyTimeZone(client, companyId))
      .toString();
  } catch (err) {
    logger.error("Failed to resolve the company timezone for first articles", {
      error: err,
      companyId
    });
    return;
  }

  for (const jobId of jobIds) {
    try {
      const created = await createFirstArticleInspections(db, {
        jobId,
        companyId,
        userId,
        today
      });
      if (created.error) {
        logger.error("Failed to create first article inspections", {
          error: created.error,
          jobId,
          companyId
        });
        continue;
      }

      for (const id of created.data.firstArticleInspectionIds) {
        const seeded = await seedFirstArticleProducts(db, client, {
          id,
          companyId,
          userId
        });
        if (seeded.error) {
          logger.error("Failed to seed first article Form 2", {
            error: seeded.error,
            firstArticleInspectionId: id,
            jobId,
            companyId
          });
        }
      }
    } catch (err) {
      logger.error("Failed to create first article inspections", {
        error: err,
        jobId,
        companyId
      });
    }
  }
}

/**
 * The job's parts whose first article is due and required (a switch applies)
 * but has no lot yet — on this job, or open on another — the job header's
 * "FAI due" badge. The same shared `resolveFirstArticleNeeds` the release
 * blocker and the generator use.
 * Informational: a failure is logged and reads as nothing due.
 */
export async function getFirstArticlesDueForJob(
  db: Kysely<KyselyDatabase>,
  client: SupabaseClient<Database>,
  args: { jobId: string; companyId: string }
): Promise<
  { jobMakeMethodId: string; description: string; reason: FirstArticleReason }[]
> {
  try {
    const today = datetime
      .today(await getCompanyTimeZone(client, args.companyId))
      .toString();
    const input = await loadFirstArticleNeedInput(db, { ...args, today });
    return resolveFirstArticleNeeds(input)
      .filter((need) => need.pending && need.reason !== null)
      .map((need) => ({
        jobMakeMethodId: need.jobMakeMethodId,
        description: need.description,
        reason: need.reason as FirstArticleReason
      }));
  } catch (err) {
    logger.error("Failed to evaluate first articles due", {
      error: err,
      ...args
    });
    return [];
  }
}

// -------------------------------------------------------------
// Form 2 — seeded from the certification lineage
// -------------------------------------------------------------

/**
 * The key a lineage row is matched on against existing Form 2 rows: its
 * certificate, or — for a row with no certificate on file — its kind and name.
 */
function productKey(row: {
  certificateId: string | null;
  kind: string;
  name: string;
}): string {
  return row.certificateId ?? `missing:${row.kind}:${row.name}`;
}

/**
 * Seeds Form 2 from the job's certification lineage at generation. Same as a
 * refresh on a Draft FAI with no rows yet.
 */
export async function seedFirstArticleProducts(
  db: Kysely<KyselyDatabase>,
  client: SupabaseClient<Database>,
  args: { id: string; companyId: string; userId: string }
): Promise<Result<{ inserted: number }>> {
  return refreshFirstArticleProducts(db, client, args);
}

/**
 * "Refresh from traceability": inserts the lineage rows not already on Form 2
 * (by certificate, or by kind + name for a missing certificate). Never deletes
 * or rewrites a row — they may carry the user's edits. Draft only.
 */
export async function refreshFirstArticleProducts(
  db: Kysely<KyselyDatabase>,
  client: SupabaseClient<Database>,
  args: { id: string; companyId: string; userId: string }
): Promise<Result<{ inserted: number }>> {
  const { id, companyId, userId } = args;

  try {
    const fai = await db
      .selectFrom("firstArticleInspection")
      .select(["jobId", "jobMakeMethodId"])
      .where("id", "=", id)
      .where("companyId", "=", companyId)
      .executeTakeFirst();
    if (!fai) throw new Error("First article not found");
    if (!fai.jobId || !fai.jobMakeMethodId) {
      throw new Error(MAKE_METHOD_GONE);
    }

    // The lineage resolver reads over supabase-js, so it runs before the
    // transaction; the transaction re-checks the status it writes under.
    const lineage = await getCertificationLineage(client, companyId, {
      jobId: fai.jobId,
      jobMakeMethodId: fai.jobMakeMethodId
    });
    if (lineage.error) throw new Error(lineage.error.message);

    const inserted = await db.transaction().execute(async (trx) => {
      const locked = await trx
        .selectFrom("firstArticleInspection")
        .select(["status"])
        .where("id", "=", id)
        .where("companyId", "=", companyId)
        .forUpdate()
        .executeTakeFirst();
      if (!locked) throw new Error("First article not found");
      if (locked.status !== "Draft") {
        throw new Error("This first article is locked");
      }

      const existing = await trx
        .selectFrom("firstArticleInspectionProduct")
        .select(["certificateId", "kind", "name", "sortOrder"])
        .where("firstArticleInspectionId", "=", id)
        .where("companyId", "=", companyId)
        .execute();

      const present = new Set(existing.map(productKey));
      let sortOrder = existing.reduce(
        (max, row) => (row.sortOrder > max ? row.sortOrder : max),
        -1
      );

      const rows = lineage.data
        .map((row: CertificationLineageRow) => ({
          ...row,
          name: row.name.trim() || row.specification?.trim() || row.kind
        }))
        .filter((row) => {
          const key = productKey(row);
          if (present.has(key)) return false;
          present.add(key);
          return true;
        })
        .map((row) => {
          sortOrder += 1;
          return {
            companyId,
            firstArticleInspectionId: id,
            sortOrder,
            kind: row.kind,
            name: row.name,
            specification: row.specification,
            supplier: row.supplierName,
            certificateNumber: row.certificateNumber,
            certificateId: row.certificateId,
            comments: row.missing ? NO_CERTIFICATE : null,
            createdBy: userId
          };
        });

      if (rows.length > 0) {
        await trx
          .insertInto("firstArticleInspectionProduct")
          .values(rows)
          .execute();
      }
      return rows.length;
    });

    return { data: { inserted }, error: null };
  } catch (err) {
    return failure(err, "Failed to refresh from traceability");
  }
}

/**
 * Adds or edits one Form 2 row. The FAI row is locked and its Draft status
 * re-checked in the same transaction as the write, so a row cannot land on an
 * FAI that is being verified or approved concurrently.
 */
export async function upsertFirstArticleInspectionProduct(
  db: Kysely<KyselyDatabase>,
  product: z.infer<typeof firstArticleInspectionProductValidator> & {
    companyId: string;
    userId: string;
  }
): Promise<Result<{ id: string }>> {
  const { id, companyId, userId, firstArticleInspectionId, ...fields } =
    product;

  const values = {
    kind: fields.kind,
    name: fields.name,
    specification: fields.specification ?? null,
    code: fields.code ?? null,
    supplier: fields.supplier ?? null,
    certificateNumber: fields.certificateNumber ?? null,
    certificateId: fields.certificateId ?? null,
    functionalTestProcedureNumber: fields.functionalTestProcedureNumber ?? null,
    acceptanceReportNumber: fields.acceptanceReportNumber ?? null,
    comments: fields.comments ?? null,
    customerApprovalVerification: fields.customerApprovalVerification
  };

  try {
    const savedId = await db.transaction().execute(async (trx) => {
      await lockDraftFirstArticle(trx, firstArticleInspectionId, companyId);

      // The certificate id comes from the form; Kysely bypasses RLS, and an
      // FK does not check the tenant.
      if (values.certificateId) {
        const certificate = await trx
          .selectFrom("certificate")
          .select(["id"])
          .where("id", "=", values.certificateId)
          .where("companyId", "=", companyId)
          .executeTakeFirst();
        if (!certificate) throw new Error("Certificate not found");
      }

      if (id) {
        const updated = await trx
          .updateTable("firstArticleInspectionProduct")
          .set({
            ...values,
            updatedBy: userId,
            updatedAt: datetime.timestamp()
          })
          .where("id", "=", id)
          .where("firstArticleInspectionId", "=", firstArticleInspectionId)
          .where("companyId", "=", companyId)
          .returning(["id"])
          .executeTakeFirst();
        if (!updated) throw new Error("Row not found");
        return updated.id;
      }

      const last = await trx
        .selectFrom("firstArticleInspectionProduct")
        .select(["sortOrder"])
        .where("firstArticleInspectionId", "=", firstArticleInspectionId)
        .where("companyId", "=", companyId)
        .orderBy("sortOrder", "desc")
        .limit(1)
        .executeTakeFirst();

      const inserted = await trx
        .insertInto("firstArticleInspectionProduct")
        .values({
          ...values,
          firstArticleInspectionId,
          sortOrder: (last?.sortOrder ?? -1) + 1,
          companyId,
          createdBy: userId
        })
        .returning(["id"])
        .executeTakeFirstOrThrow();
      return inserted.id;
    });
    return { data: { id: savedId }, error: null };
  } catch (err) {
    return failure(err, "Failed to save the row");
  }
}

/** Deletes one Form 2 row of a Draft FAI, under the same FAI lock. */
export async function deleteFirstArticleInspectionProduct(
  db: Kysely<KyselyDatabase>,
  args: { id: string; firstArticleInspectionId: string; companyId: string }
): Promise<Result<{ id: string }>> {
  try {
    await db.transaction().execute(async (trx) => {
      await lockDraftFirstArticle(
        trx,
        args.firstArticleInspectionId,
        args.companyId
      );
      const deleted = await trx
        .deleteFrom("firstArticleInspectionProduct")
        .where("id", "=", args.id)
        .where("firstArticleInspectionId", "=", args.firstArticleInspectionId)
        .where("companyId", "=", args.companyId)
        .returning(["id"])
        .executeTakeFirst();
      if (!deleted) throw new Error("Row not found");
    });
    return { data: { id: args.id }, error: null };
  } catch (err) {
    return failure(err, "Failed to delete the row");
  }
}

async function lockDraftFirstArticle(
  trx: Kysely<KyselyDatabase>,
  id: string,
  companyId: string
): Promise<void> {
  const fai = await trx
    .selectFrom("firstArticleInspection")
    .select(["status"])
    .where("id", "=", id)
    .where("companyId", "=", companyId)
    .forUpdate()
    .executeTakeFirst();
  if (!fai) throw new Error("First article not found");
  if (fai.status !== "Draft") throw new Error("This first article is locked");
}

// -------------------------------------------------------------
// Lifecycle — Draft → Verified → Approved
// -------------------------------------------------------------

const DISPOSITIONED = ["Passed", "Failed", "Partial"];

async function signatory(
  trx: Kysely<KyselyDatabase>,
  userId: string,
  companyId: string
): Promise<{ name: string; title: string | null }> {
  const [user, job] = await Promise.all([
    trx
      .selectFrom("user")
      .select(["fullName", "firstName", "lastName"])
      .where("id", "=", userId)
      .executeTakeFirst(),
    trx
      .selectFrom("employeeJob")
      .select(["title"])
      .where("id", "=", userId)
      .where("companyId", "=", companyId)
      .executeTakeFirst()
  ]);
  const name =
    user?.fullName?.trim() ||
    [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() ||
    userId;
  return { name, title: job?.title?.trim() || null };
}

/**
 * AS9102 fields 19–21. The lot must be dispositioned first: the verification
 * snapshots whether the FAIR documents a nonconformance — the lot failed or
 * was partial, or an NCR is linked to the lot or to an operation of the make
 * method.
 */
export async function verifyFirstArticleInspection(
  db: Kysely<KyselyDatabase>,
  args: { id: string; companyId: string; userId: string }
): Promise<Result<{ id: string }>> {
  const { id, companyId, userId } = args;
  try {
    await db.transaction().execute(async (trx) => {
      const fai = await trx
        .selectFrom("firstArticleInspection")
        .select(["status", "inspectionId", "jobMakeMethodId"])
        .where("id", "=", id)
        .where("companyId", "=", companyId)
        .forUpdate()
        .executeTakeFirst();
      if (!fai) throw new Error("First article not found");
      if (fai.status !== "Draft") {
        throw new Error("Only a draft first article can be verified");
      }
      const jobMakeMethodId = fai.jobMakeMethodId;
      if (!jobMakeMethodId) throw new Error(MAKE_METHOD_GONE);

      const lot = await trx
        .selectFrom("inspection")
        .select(["status"])
        .where("id", "=", fai.inspectionId)
        .where("companyId", "=", companyId)
        .executeTakeFirst();
      if (!lot || !DISPOSITIONED.includes(lot.status)) {
        throw new Error("Disposition the inspection before verifying");
      }

      const [lotNcr, operationNcr] = await Promise.all([
        trx
          .selectFrom("nonConformanceInspection")
          .select(["id"])
          .where("inspectionId", "=", fai.inspectionId)
          .where("companyId", "=", companyId)
          .limit(1)
          .executeTakeFirst(),
        trx
          .selectFrom("nonConformanceJobOperation")
          .innerJoin(
            "jobOperation",
            "jobOperation.id",
            "nonConformanceJobOperation.jobOperationId"
          )
          .select(["nonConformanceJobOperation.id"])
          .where("jobOperation.jobMakeMethodId", "=", jobMakeMethodId)
          .where("nonConformanceJobOperation.companyId", "=", companyId)
          .limit(1)
          .executeTakeFirst()
      ]);

      const hasNonconformance =
        lot.status === "Failed" ||
        lot.status === "Partial" ||
        !!lotNcr ||
        !!operationNcr;

      const verifier = await signatory(trx, userId, companyId);
      const now = datetime.timestamp();

      await trx
        .updateTable("firstArticleInspection")
        .set({
          status: "Verified",
          hasNonconformance,
          verifiedBy: userId,
          verifiedByName: verifier.name,
          verifiedByTitle: verifier.title,
          verifiedAt: now,
          updatedBy: userId,
          updatedAt: now
        })
        .where("id", "=", id)
        .where("companyId", "=", companyId)
        .execute();
    });
    return { data: { id }, error: null };
  } catch (err) {
    return failure(err, "Failed to verify first article");
  }
}

/** Verified → Draft. The lot stays closed; its measurements stay locked. */
export async function reopenFirstArticleInspection(
  db: Kysely<KyselyDatabase>,
  args: { id: string; companyId: string; userId: string }
): Promise<Result<{ id: string }>> {
  const { id, companyId, userId } = args;
  try {
    await db.transaction().execute(async (trx) => {
      const fai = await trx
        .selectFrom("firstArticleInspection")
        .select(["status"])
        .where("id", "=", id)
        .where("companyId", "=", companyId)
        .forUpdate()
        .executeTakeFirst();
      if (!fai) throw new Error("First article not found");
      if (fai.status !== "Verified") {
        throw new Error("Only a verified first article can be reopened");
      }

      await trx
        .updateTable("firstArticleInspection")
        .set({
          status: "Draft",
          hasNonconformance: null,
          verifiedBy: null,
          verifiedByName: null,
          verifiedByTitle: null,
          verifiedAt: null,
          updatedBy: userId,
          updatedAt: datetime.timestamp()
        })
        .where("id", "=", id)
        .where("companyId", "=", companyId)
        .execute();
    });
    return { data: { id }, error: null };
  } catch (err) {
    return failure(err, "Failed to reopen first article");
  }
}

/**
 * AS9102 fields 22/23. Renders the FAIR with the approver's signature, stores
 * it as a document on the job and locks the FAI — the stored PDF is the
 * record, so later plan or data edits cannot change what was approved. The
 * file is uploaded before the transaction and removed again if it fails.
 */
export async function approveFirstArticleInspection(
  db: Kysely<KyselyDatabase>,
  client: SupabaseClient<Database>,
  args: { id: string; companyId: string; userId: string; locale?: string }
): Promise<Result<{ id: string; documentId: string }>> {
  const { id, companyId, userId, locale } = args;

  const serviceRole = getCarbonServiceRole();
  let uploadedPath: string | null = null;
  try {
    const approver = await signatory(db, userId, companyId);
    const approvedAt = datetime.timestamp();

    const rendered = await renderFirstArticleInspectionPdf(client, {
      id,
      companyId,
      locale,
      approval: { name: approver.name, title: approver.title, approvedAt }
    });
    if (rendered.error) throw new Error(rendered.error.message);
    const { pdf, firstArticle, fairIdentifier } = rendered.data;
    if (firstArticle.status !== "Verified") {
      throw new Error("Only a verified first article can be approved");
    }

    // A unique name per approval: a retry never overwrites (or, on failure,
    // removes) a file another attempt stored. Filed on the job when it still
    // exists (the job's files list it), else under the FAI.
    const fileName = `${
      stripSpecialCharacters(
        `${fairIdentifier} FAIR ${approvedAt.slice(0, 19)}`
      ) || "fair"
    }.pdf`;
    const jobId = firstArticle.jobId;
    const filePath = jobId
      ? `${companyId}/job/${jobId}/${fileName}`
      : `${companyId}/first-article/${id}/${fileName}`;

    // The caller proved access by reading the FAI under their own client and
    // companyId (the render above). The record is written with the service
    // role: a quality approver need not hold the job's storage permissions,
    // and the file route serves it the same way.
    const upload = await storage(serviceRole)
      .company(companyId)
      .upload(filePath, new Uint8Array(pdf), {
        cacheControl: `${12 * 60 * 60}`,
        contentType: "application/pdf",
        upsert: false
      });
    if (upload.error) throw new Error(upload.error.message);
    uploadedPath = filePath;

    const documentId = await db.transaction().execute(async (trx) => {
      const locked = await trx
        .selectFrom("firstArticleInspection")
        .select(["status"])
        .where("id", "=", id)
        .where("companyId", "=", companyId)
        .forUpdate()
        .executeTakeFirst();
      if (!locked) throw new Error("First article not found");
      if (locked.status !== "Verified") {
        throw new Error("Only a verified first article can be approved");
      }

      const document = await trx
        .insertInto("document")
        .values({
          path: filePath,
          name: fileName,
          // KB, as every other document row stores it.
          size: Math.round(pdf.byteLength / 1024),
          type: "PDF",
          sourceDocument: jobId ? "Job" : null,
          sourceDocumentId: jobId,
          readGroups: [userId],
          writeGroups: [userId],
          companyId,
          createdBy: userId
        })
        .returning(["id"])
        .executeTakeFirstOrThrow();

      await trx
        .updateTable("firstArticleInspection")
        .set({
          status: "Approved",
          approvedBy: userId,
          approvedByName: approver.name,
          approvedByTitle: approver.title,
          approvedAt,
          documentId: document.id,
          updatedBy: userId,
          updatedAt: approvedAt
        })
        .where("id", "=", id)
        .where("companyId", "=", companyId)
        .execute();

      return document.id;
    });

    return { data: { id, documentId }, error: null };
  } catch (err) {
    if (uploadedPath) {
      const removed = await storage(serviceRole)
        .company(companyId)
        .remove([uploadedPath]);
      if (removed.error) {
        logger.error("Failed to remove an orphaned FAIR upload", {
          error: removed.error,
          path: uploadedPath,
          firstArticleInspectionId: id
        });
      }
    }
    return failure(err, "Failed to approve first article");
  }
}

/**
 * Deletes a Draft FAI whose lot has no readings, by deleting the lot — the
 * extension, its Form 2 rows, sampling plans and samples cascade.
 */
export async function deleteFirstArticleInspection(
  db: Kysely<KyselyDatabase>,
  args: { id: string; companyId: string }
): Promise<Result<{ id: string }>> {
  const { id, companyId } = args;
  try {
    await db.transaction().execute(async (trx) => {
      const fai = await trx
        .selectFrom("firstArticleInspection")
        .select(["status", "inspectionId"])
        .where("id", "=", id)
        .where("companyId", "=", companyId)
        .forUpdate()
        .executeTakeFirst();
      if (!fai) throw new Error("First article not found");
      if (fai.status !== "Draft") {
        throw new Error("Only a draft first article can be deleted");
      }

      const measurement = await trx
        .selectFrom("inspectionMeasurement")
        .select(["id"])
        .where("inspectionId", "=", fai.inspectionId)
        .where("companyId", "=", companyId)
        .limit(1)
        .executeTakeFirst();
      if (measurement) {
        throw new Error(
          "This first article has recorded results and cannot be deleted"
        );
      }

      await trx
        .deleteFrom("inspection")
        .where("id", "=", fai.inspectionId)
        .where("companyId", "=", companyId)
        .execute();
    });
    return { data: { id }, error: null };
  } catch (err) {
    return failure(err, "Failed to delete first article");
  }
}
