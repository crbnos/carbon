import type { getCarbonServiceRole } from "@carbon/auth/client.server";
import { trigger } from "@carbon/jobs";
import { nanoid } from "nanoid";
import { seedCompany } from "~/modules/settings";

type ServiceRole = ReturnType<typeof getCarbonServiceRole>;

/** Pull the most recent published demo for an industry from the catalog bucket,
 *  or null when none exists yet (caller falls back to a clean company). */
export async function fetchDemoBackup(
  serviceRole: ServiceRole,
  industryId: string | null
): Promise<Blob | null> {
  if (!industryId) return null;
  const industry = await serviceRole
    .from("industry")
    .select("backupPath")
    .eq("id", industryId)
    .maybeSingle();
  if (!industry.data?.backupPath) return null;

  const download = await serviceRole.storage
    .from("company-demos")
    .download(industry.data.backupPath);
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
    backup
  }: { companyId: string; userId: string; backup: Blob | null }
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
      autoFinalize: true
    });
  } catch (err) {
    console.error(err);
    throw new Error("Fatal: failed to start company data import");
  }
}
