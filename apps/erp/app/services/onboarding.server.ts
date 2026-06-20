import type { getCarbonServiceRole } from "@carbon/auth/client.server";
import { trigger } from "@carbon/jobs";
import { nanoid } from "nanoid";
import { seedCompany } from "~/modules/settings";

type ServiceRole = ReturnType<typeof getCarbonServiceRole>;

/** Pull the most recent published demo for an industry from the catalog bucket,
 *  or null when none exists yet (caller falls back to a clean company). */
export async function fetchDemoArtifact(
  serviceRole: ServiceRole,
  industryId: string | null
): Promise<Blob | null> {
  if (!industryId) return null;
  const template = await serviceRole
    .from("companyTemplate")
    .select("artifactPath")
    .eq("industryId", industryId)
    .order("createdAt", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!template.data) return null;

  const download = await serviceRole.storage
    .from("company-templates")
    .download(template.data.artifactPath);
  return download.data ?? null;
}

/**
 * Provision a freshly-created company's data. Demo and "bring your own data"
 * both resolve to a backup artifact that's reseed-imported on top of an
 * identity-only seed (the artifact carries the chart of accounts + business
 * data). With no artifact — a clean choice, or a demo with nothing published
 * yet — fall back to a full clean seed.
 */
export async function provisionCompanyData(
  serviceRole: ServiceRole,
  {
    companyId,
    userId,
    artifact
  }: { companyId: string; userId: string; artifact: Blob | null }
): Promise<void> {
  if (!artifact) {
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
    .upload(filePath, artifact, {
      upsert: true,
      contentType: "application/gzip"
    });
  if (upload.error) {
    console.error(upload.error);
    throw new Error("Fatal: failed to upload import file");
  }

  trigger("company-import", {
    companyId,
    userId,
    filePath,
    mode: "reseed",
    importRunId: nanoid(),
    autoFinalize: true
  });
}
