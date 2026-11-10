// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { createPmiInspectionPlan } from "@carbon/database/quality";
import { storage } from "@carbon/files";
import {
  parsePmiDocument,
  pmiInspectionCharacteristics
} from "@carbon/viewer/pmi";
import { getJobDatabaseClient } from "../../../db";
import { inngest } from "../../client";

/**
 * Makes an inspection plan from a model's PMI for every item that uses the
 * model and has no plan for it yet (spec
 * `.ai/specs/2026-10-27-pmi-inspection-plans.md`). Each dimension and
 * geometric tolerance becomes one characteristic; the plan holds the model and
 * no PDF, so the inspection screens show the model.
 *
 * Sent by `model-optimize` once a run has written `pmi.json` (every item on
 * the model), and by the `queue_pmi_inspection_plans` handler when an item
 * starts using a model whose PMI was already read (that item only). A plan is
 * made once per item and model and never rewritten: the partial unique index
 * `inspectionDocument_part_model_key` turns a second insert into a no-op.
 */
export const pmiInspectionPlanFunction = inngest.createFunction(
  {
    id: "pmi-inspection-plan",
    retries: 2,
    concurrency: {
      key: "event.data.companyId + '-' + event.data.modelUploadId",
      limit: 1
    }
  },
  { event: "carbon/pmi-inspection-plan" },
  async ({ event, step, logger }) => {
    const { companyId, modelUploadId, itemId } = event.data;

    return step.run("create-plans", async () => {
      const db = getJobDatabaseClient();

      const model = await db
        .selectFrom("modelUpload")
        .select(["pmiPath"])
        .where("id", "=", modelUploadId)
        .where("companyId", "=", companyId)
        .executeTakeFirst();
      if (!model?.pmiPath) return { created: 0, reason: "no-pmi" as const };

      let items = db
        .selectFrom("item")
        .select(["id"])
        .where("companyId", "=", companyId)
        .where("modelUploadId", "=", modelUploadId)
        .where((eb) =>
          eb.not(
            eb.exists(
              eb
                .selectFrom("inspectionDocument")
                .select("inspectionDocument.id")
                .whereRef("inspectionDocument.partId", "=", "item.id")
                .where("inspectionDocument.companyId", "=", companyId)
                .where("inspectionDocument.modelUploadId", "=", modelUploadId)
            )
          )
        );
      if (itemId) items = items.where("id", "=", itemId);
      const itemIds = (await items.execute()).map((row) => row.id);
      if (itemIds.length === 0) {
        return { created: 0, reason: "no-items" as const };
      }

      const download = await storage(getCarbonServiceRole())
        .company(companyId)
        .download(model.pmiPath);
      if (!download.data) {
        throw new Error(
          `Failed to download pmi.json for model ${modelUploadId}: ${download.error.message}`
        );
      }
      const pmi = parsePmiDocument(JSON.parse(await download.data.text()));
      if (!pmi) {
        logger.warn("pmi.json did not parse; no inspection plan made", {
          companyId,
          modelUploadId,
          pmiPath: model.pmiPath
        });
        return { created: 0, reason: "unreadable-pmi" as const };
      }

      const characteristics = pmiInspectionCharacteristics(pmi);
      if (characteristics.length === 0) {
        // Datums and notes only: nothing to measure, so no plan.
        logger.info("PMI has no dimension or tolerance; no inspection plan", {
          companyId,
          modelUploadId
        });
        return { created: 0, reason: "no-characteristics" as const };
      }

      let created = 0;
      for (const id of itemIds) {
        const planId = await db.transaction().execute((trx) =>
          createPmiInspectionPlan(trx, {
            companyId,
            itemId: id,
            modelUploadId,
            characteristics,
            createdBy: "system"
          })
        );
        if (planId) {
          created += 1;
          logger.info("inspection plan made from PMI", {
            modelUploadId,
            itemId: id,
            planId,
            characteristics: characteristics.length
          });
        }
      }
      return { created, reason: "ok" as const };
    });
  }
);
