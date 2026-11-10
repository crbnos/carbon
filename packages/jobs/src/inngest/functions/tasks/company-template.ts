// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getCompanyTimeZone } from "@carbon/database";
import { getProcessPool } from "@carbon/database/client";
import { applyDataset, getDataset } from "@carbon/database/datasets";
import { datetime } from "@carbon/utils";
import { NonRetriableError } from "inngest";
import { resolveRestoreScope } from "../../../backups/load";
import {
  failRun,
  keepRun,
  PER_COMPANY_CONCURRENCY,
  progressWriter,
  revertRun,
  runMarker,
  TEMPLATE_INTEGRATION,
  type TemplateRunMeta,
  takeSnapshot
} from "../../../backups/runs";
import { getJobDatabaseClient } from "../../../db";
import { planDemoCompany } from "../../../demo-planning";
import { inngest } from "../../client";

/** One marker per company: a second apply waits on this one's keep or revert. */
const templateMarker = (
  client: ReturnType<typeof getCarbonServiceRole>,
  args: { companyId: string; templateRunId: string; userId: string }
) =>
  runMarker<TemplateRunMeta>(client, {
    integration: TEMPLATE_INTEGRATION,
    entityType: "template",
    entityId: args.companyId,
    companyId: args.companyId,
    userId: args.userId,
    identity: { templateRunId: args.templateRunId }
  });

/** The company's marker, when it belongs to `templateRunId`: a keep or revert
 *  sent for an earlier run must not resolve a later one. */
async function ownMarker(
  client: ReturnType<typeof getCarbonServiceRole>,
  args: { companyId: string; templateRunId: string; userId: string }
) {
  const marker = templateMarker(client, args);
  const meta = await marker.read();
  return meta?.templateRunId === args.templateRunId ? marker : null;
}

export const companyTemplateFunction = inngest.createFunction(
  {
    id: "company-template",
    retries: 1,
    // The unkeyed limit stops N companies onboarding together from outnumbering
    // the pool below — each run holds one of its two connections for a whole
    // transaction.
    concurrency: [{ limit: 2 }, PER_COMPANY_CONCURRENCY]
  },
  { event: "carbon/company-template" },
  async ({ event, step, logger }) => {
    const { companyId, userId, datasetKey, templateRunId } = event.data;

    const applied = await step.run("apply-template", async () => {
      const client = getCarbonServiceRole();
      const marker = templateMarker(client, {
        companyId,
        templateRunId,
        userId
      });

      const dataset = getDataset(datasetKey);
      if (!dataset) {
        const error = `Unknown dataset "${datasetKey}"`;
        await marker.write({ status: "failed", datasetKey, error });
        // Retrying an unknown key can never succeed.
        throw new NonRetriableError(error);
      }

      // A pending keep/revert owns the only snapshot of the user's real data.
      // Applying again would overwrite it, so refuse until it is resolved. A
      // marker naming THIS run is a retry of it, not a second apply.
      const existing = await marker.read();
      if (
        existing &&
        existing.templateRunId !== templateRunId &&
        existing.status !== "failed"
      ) {
        throw new NonRetriableError(
          "A demo data change is already pending — keep or revert it first."
        );
      }

      await marker.write({
        status: "running",
        datasetKey,
        startedAt: datetime.timestamp(),
        // A retry, or a new run after a failed one, inherits that marker's error.
        error: null,
        planningError: null,
        reason: null,
        violations: null,
        violationRowsByTable: null
      });
      const report = progressWriter(marker);

      // Everything past the `running` marker must be able to reach the failure
      // marker. getCompanyTimeZone throws on a read error and pool.connect()
      // throws on its 10s acquisition timeout — outside this try, either would
      // leave the marker stuck on `running` forever.
      const pool = getProcessPool();
      let pgClient: Parameters<typeof applyDataset>[0] | null = null;
      try {
        const db = getJobDatabaseClient();
        const { includeGroup } = await resolveRestoreScope(client, companyId);
        await takeSnapshot(client, db, marker, {
          run: "template",
          runId: templateRunId,
          companyId,
          userId,
          record: { includeGroup },
          onProgress: report
        });

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
          wipeFirst: true,
          log: (message) => logger.info(message, { companyId, templateRunId }),
          onProgress: (p) => report({ ...p, phase: "seed" })
        });
      } catch (err) {
        throw await failRun(marker, err);
      } finally {
        pgClient?.release();
      }

      // Parked on keep/revert: the marker holds the snapshot until the user decides.
      await marker.write({ status: "ready", progress: null });
      return { templateRunId, datasetKey };
    });

    // Non-fatal: the data is committed, and the MRP cron heals a missed run.
    await step.run("plan-template", async () => {
      const planning = await planDemoCompany({ companyId, userId });
      const failures = [
        ...(planning.mrp === "ok" ? [] : [`MRP: ${planning.mrp}`]),
        ...planning.schedule
          .filter((s) => s.result !== "ok")
          .map((s) => `Schedule ${s.locationId}: ${s.result}`)
      ];
      if (failures.length === 0) return planning;

      const planningError = failures.join("; ");
      logger.error("Demo template planning failed", {
        companyId,
        templateRunId,
        planningError
      });
      try {
        // Only this run's marker records it: writing to a resolved one would
        // resurrect it as `running`.
        const marker = await ownMarker(getCarbonServiceRole(), {
          companyId,
          templateRunId,
          userId
        });
        await marker?.write({ planningError });
      } catch (err) {
        logger.error("Failed to record planning error", {
          companyId,
          templateRunId,
          error: (err as Error).message
        });
      }
      return planning;
    });

    return applied;
  }
);

/**
 * Keep an applied demo template, or dismiss a failed one: delete the snapshot,
 * then the marker. Routed here rather than deleting the row from the app, which
 * would strand the snapshot: a failed revert keeps it so the user can retry.
 */
export const companyTemplateFinalizeFunction = inngest.createFunction(
  {
    id: "company-template-finalize",
    retries: 1,
    concurrency: PER_COMPANY_CONCURRENCY
  },
  { event: "carbon/company-template-finalize" },
  async ({ event, step, logger }) => {
    const { companyId, templateRunId } = event.data;
    return await step.run("finalize-template", async () => {
      const client = getCarbonServiceRole();
      const marker = await ownMarker(client, {
        companyId,
        templateRunId,
        userId: ""
      });
      const resolved = marker
        ? await keepRun(client, marker, companyId)
        : false;
      logger.info("Demo template resolved", {
        companyId,
        templateRunId,
        resolved
      });
      return { templateRunId, resolved };
    });
  }
);

/** Undo an applied demo template — wipe again and reload the snapshot. */
export const companyTemplateRevertFunction = inngest.createFunction(
  {
    id: "company-template-revert",
    retries: 1,
    concurrency: PER_COMPANY_CONCURRENCY
  },
  { event: "carbon/company-template-revert" },
  async ({ event, step, logger }) => {
    const { companyId, userId, templateRunId } = event.data;
    return await step.run("revert-template", async () => {
      const client = getCarbonServiceRole();
      const marker = await ownMarker(client, {
        companyId,
        templateRunId,
        userId
      });
      const result = marker
        ? await revertRun(client, getJobDatabaseClient(), marker, companyId)
        : { reverted: false };
      logger.info("Demo template revert", {
        companyId,
        templateRunId,
        ...result
      });
      return { templateRunId, ...result };
    });
  }
);
