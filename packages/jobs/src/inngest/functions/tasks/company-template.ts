import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getCompanyTimeZone } from "@carbon/database";
import { getPostgresConnectionPool } from "@carbon/database/client";
import { applyDataset, getDataset } from "@carbon/database/datasets";
import { datetime } from "@carbon/utils";
import { NonRetriableError } from "inngest";
import { inngest } from "../../client";

export const TEMPLATE_INTEGRATION = "company-template";

type ServiceRole = ReturnType<typeof getCarbonServiceRole>;

type TemplateStatus = "running" | "failed";

type TemplateMeta = {
  templateRunId: string;
  status: TemplateStatus;
  datasetKey?: string;
  startedAt?: string;
  error?: string | null;
};

/**
 * One marker row per company, mirroring company-export. The partial unique index
 * on ("integration","externalId","entityType","companyId") means a second row for
 * the same company is rejected outright, so identity lives in the metadata's
 * templateRunId rather than in externalId.
 */
async function readTemplateMarker(
  client: ServiceRole,
  companyId: string
): Promise<{ id: string; metadata: TemplateMeta } | null> {
  const marker = await client
    .from("externalIntegrationMapping")
    .select("id, metadata")
    .eq("integration", TEMPLATE_INTEGRATION)
    .eq("companyId", companyId)
    .maybeSingle();
  if (marker.error) {
    throw new Error(`Failed to read template marker: ${marker.error.message}`);
  }
  if (!marker.data) return null;
  return {
    id: marker.data.id,
    metadata: (marker.data.metadata ?? {}) as TemplateMeta
  };
}

/**
 * Upsert the template marker, merging `patch` into its metadata. Cleared on
 * success — a company holding a `failed` marker is the signal that its demo data
 * never landed, which an empty company alone cannot tell you. Errors throw: a
 * marker that silently failed to write is worse than none, because the contract
 * reads a missing marker as "the job never ran".
 */
async function writeTemplateMarker(
  client: ServiceRole,
  args: {
    companyId: string;
    userId: string;
    templateRunId: string;
    patch: Partial<TemplateMeta>;
  }
): Promise<void> {
  const { companyId, userId, templateRunId, patch } = args;
  const existing = await readTemplateMarker(client, companyId);
  const metadata: TemplateMeta = {
    templateRunId,
    status: "running",
    ...existing?.metadata,
    ...patch
  };

  const written = existing
    ? await client
        .from("externalIntegrationMapping")
        .update({ metadata })
        .eq("id", existing.id)
        .eq("companyId", companyId)
    : await client.from("externalIntegrationMapping").insert({
        entityType: "template",
        entityId: companyId,
        integration: TEMPLATE_INTEGRATION,
        externalId: "",
        metadata,
        companyId,
        createdBy: userId
      });

  if (written.error) {
    throw new Error(
      `Failed to write template marker: ${written.error.message}`
    );
  }
}

async function clearTemplateMarker(
  client: ServiceRole,
  companyId: string
): Promise<void> {
  const cleared = await client
    .from("externalIntegrationMapping")
    .delete()
    .eq("integration", TEMPLATE_INTEGRATION)
    .eq("companyId", companyId);
  if (cleared.error) {
    throw new Error(
      `Failed to clear template marker: ${cleared.error.message}`
    );
  }
}

export const companyTemplateFunction = inngest.createFunction(
  {
    id: "company-template",
    retries: 1,
    // Per company so one company can never apply two templates at once, AND
    // unkeyed so N companies onboarding together cannot outnumber the pool
    // below — each run holds one of its two connections for a whole transaction.
    concurrency: [{ limit: 2 }, { key: "event.data.companyId", limit: 1 }]
  },
  { event: "carbon/company-template" },
  async ({ event, step, logger }) => {
    const { companyId, userId, datasetKey, templateRunId } = event.data;

    return await step.run("apply-template", async () => {
      const client = getCarbonServiceRole();

      const dataset = getDataset(datasetKey);
      if (!dataset) {
        const error = `Unknown dataset "${datasetKey}"`;
        await writeTemplateMarker(client, {
          companyId,
          userId,
          templateRunId,
          patch: { status: "failed", datasetKey, error }
        });
        // Retrying an unknown key can never succeed.
        throw new NonRetriableError(error);
      }

      // A template is a one-shot on a fresh company. Re-running it would
      // duplicate the whole catalog, so refuse rather than double-apply.
      const existingItems = await client
        .from("item")
        .select("id", { count: "exact", head: true })
        .eq("companyId", companyId);
      if (existingItems.error) {
        throw new Error(
          `Failed to count existing items: ${existingItems.error.message}`
        );
      }
      if ((existingItems.count ?? 0) > 0) {
        // Refusing is a no-op, never a failure — writing `failed` here would
        // stamp a correctly-seeded company on the two routine paths that reach
        // it: onboarding re-entry, and a retry whose first attempt committed but
        // whose response was lost. A marker naming THIS run is the proof it was
        // the latter, so clear it and report success.
        const marker = await readTemplateMarker(client, companyId);
        const alreadyApplied = marker?.metadata.templateRunId === templateRunId;
        await clearTemplateMarker(client, companyId);
        logger.info(
          alreadyApplied
            ? "Template already applied by an earlier attempt of this run"
            : "Company already has items — skipping demo template",
          { companyId, templateRunId }
        );
        return { templateRunId, skipped: true, alreadyApplied };
      }

      await writeTemplateMarker(client, {
        companyId,
        userId,
        templateRunId,
        patch: {
          status: "running",
          datasetKey,
          startedAt: datetime.timestamp()
        }
      });

      // Everything past the `running` marker must be able to reach the failure
      // marker. getCompanyTimeZone throws on a read error and pool.connect()
      // throws on its 10s acquisition timeout — outside this try, either would
      // leave the marker stuck on `running` forever.
      const pool = getPostgresConnectionPool(2);
      let pgClient: Parameters<typeof applyDataset>[0] | null = null;
      try {
        const timeZone = await getCompanyTimeZone(client, companyId);

        // A dedicated pool: applyDataset holds one connection for the whole
        // transaction, and the shared size-1 pool behind getJobDatabaseClient is
        // what the event drainer and workflow matcher run on.
        pgClient = await pool.connect();
        await applyDataset(pgClient, {
          companyId,
          userId,
          dataset,
          timeZone,
          log: (message) => logger.info(message, { companyId, templateRunId })
        });
      } catch (err) {
        await writeTemplateMarker(client, {
          companyId,
          userId,
          templateRunId,
          patch: {
            status: "failed",
            datasetKey,
            error: (err as Error).message
          }
        });
        throw err;
      } finally {
        pgClient?.release();
      }

      // The data landing IS the success signal; a lingering marker would read
      // as an unfinished run.
      await clearTemplateMarker(client, companyId);

      return { templateRunId, datasetKey };
    });
  }
);
