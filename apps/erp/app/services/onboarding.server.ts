import type { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import { trigger } from "@carbon/jobs";
import { isInternalEmail } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { nanoid } from "nanoid";
import { type onboardingIndustryTypes, seedCompany } from "~/modules/settings";

type ServiceRole = ReturnType<typeof getCarbonServiceRole>;

/**
 * "Bring your own data" (restore from a backup) is a power feature for local dev
 * + migrations. Available to Carbon-internal users and in any non-production
 * environment; re-checked in the action so it can't be reached by a crafted post.
 */
export async function canImportData(
  client: SupabaseClient<Database>,
  userId: string
): Promise<boolean> {
  if (process.env.NODE_ENV !== "production") return true;
  const user = await client
    .from("user")
    .select("email")
    .eq("id", userId)
    .single();
  return isInternalEmail(user.data?.email);
}

/** Pull the most recent published demo for an industry from the catalog bucket,
 *  or null when none exists yet (caller falls back to a clean company). */
export async function fetchDemoArtifact(
  serviceRole: ServiceRole,
  industryId: (typeof onboardingIndustryTypes)[number]
): Promise<Blob | null> {
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
