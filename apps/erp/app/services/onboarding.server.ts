import type { getCarbonServiceRole } from "@carbon/auth/client.server";
import { trigger } from "@carbon/jobs";
import { nanoid } from "nanoid";
import { seedCompany } from "~/modules/settings";

type ServiceRole = ReturnType<typeof getCarbonServiceRole>;

/** Pull the onboarding backup template for an industry from the shared
 *  company-templates bucket, or null when none is committed yet for that
 *  industry (caller falls back to a clean company). Templates are uploaded at
 *  deploy from packages/database/supabase/backups/<industryId>.carbon.json.gz. */
export async function fetchTemplateBackup(
  serviceRole: ServiceRole,
  industryId: string | null
): Promise<Blob | null> {
  if (!industryId) return null;
  const download = await serviceRole.storage
    .from("company-templates")
    .download(`templates/${industryId}.carbon.json.gz`);
  if (download.error) {
    // A missing template is expected (none authored for this industry yet) and
    // falls back to a clean seed. Log so a transient storage failure isn't
    // silently swallowed into an empty company.
    console.warn(
      `No backup template for industry "${industryId}":`,
      download.error.message
    );
    return null;
  }
  return download.data ?? null;
}

/**
 * Provision a freshly-created company's data. Demo and "bring your own data"
 * both resolve to a backup that's reseed-imported on top of an identity-only
 * seed (the backup carries the chart of accounts + business data). With no
 * backup — a clean choice, or a demo with nothing published yet — fall back to
 * a full clean seed.
 */
export async function provisionCompanyData(
  serviceRole: ServiceRole,
  {
    companyId,
    userId,
    backup,
    templateIndustryId
  }: {
    companyId: string;
    userId: string;
    backup: Blob | null;
    /** Set when `backup` is a demo template (vs a user's own uploaded backup).
     *  Makes the import reference the template's shared assets instead of
     *  copying its files into this company's storage prefix. */
    templateIndustryId?: string | null;
  }
): Promise<void> {
  if (!backup) {
    const seed = await seedCompany(serviceRole, companyId, userId);
    if (seed.error) {
      console.error(seed.error);
      throw new Error("Fatal: failed to seed company");
    }
    return;
  }

  const seed = await seedCompany(serviceRole, companyId, userId, {
    identityOnly: true
  });
  if (seed.error) {
    console.error(seed.error);
    throw new Error("Fatal: failed to seed company");
  }

  const filePath = "exports/onboarding-import.carbon.json.gz";
  const upload = await serviceRole.storage
    .from(companyId)
    .upload(filePath, backup, {
      upsert: true,
      contentType: "application/gzip"
    });
  if (upload.error) {
    console.error(upload.error);
    throw new Error("Fatal: failed to upload import file");
  }

  // Kick off the import. The job runs asynchronously (the company's data
  // populates shortly after onboarding finishes), but the *enqueue* is awaited
  // and surfaced: a failed send (e.g. Inngest unreachable) would otherwise
  // leave the company with only the identity seed — an empty chart of accounts
  // — while onboarding reported success. Fail loudly instead, like the seed.
  try {
    await trigger("company-import", {
      companyId,
      userId,
      filePath,
      mode: "reseed",
      importRunId: nanoid(),
      autoFinalize: true,
      ...(templateIndustryId ? { templateIndustryId } : {})
    });
  } catch (err) {
    console.error(err);
    throw new Error("Fatal: failed to start company data import");
  }
}
