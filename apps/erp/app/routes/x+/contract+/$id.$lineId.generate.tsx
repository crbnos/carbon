// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { defaultUpgradeMessage, resolveRequirement } from "@carbon/ee/plan";
import { generateCostPlusItems } from "@carbon/ee/project-revenue.server";
import { getLogger } from "@carbon/logger";
import { serverFns } from "@carbon/server-functions";
import { datetime, getErrorMessage, redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { getContractLine } from "~/modules/sales/sales.service";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";
import { getDatabaseClient } from "~/services/database.server";
import { path, requestReferrer } from "~/utils/path";

const logger = getLogger("erp", "contract-line-generate");

/**
 * Generate billable items: the line's items for ledger rows posted up to
 * today that have none yet — work posted before the line existed, or rows
 * the job SQL wrote. A Time & Materials line runs the T&M backfill; a Cost
 * Plus line runs the commercial generator, which a company without
 * `PROJECT_REVENUE` cannot (it reports `gated`).
 */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "sales"
  });

  const { id, lineId } = params;
  if (!id) throw new Error("Could not find id");
  if (!lineId) throw new Error("Could not find lineId");

  const back =
    requestReferrer(request) ?? path.to.contractLineBilling(id, lineId);

  const line = await getContractLine(client, lineId, companyId);
  if (line.error || line.data.customerContractId !== id) {
    throw redirect(
      back,
      await flash(request, error(line.error, "The line was not found"))
    );
  }

  const through = datetime
    .today(await getCompanyTimeZone(client, companyId))
    .toString();
  const db = getDatabaseClient();

  let generated = 0;
  if (line.data.billingMethod === "Cost Plus") {
    let result: Awaited<ReturnType<typeof generateCostPlusItems>>;
    try {
      result = await generateCostPlusItems(db, {
        companyId,
        userId,
        through,
        customerContractLineId: lineId
      });
    } catch (err) {
      logger.error("Failed to generate Cost Plus items", {
        companyId,
        lineId,
        error: err
      });
      throw redirect(
        back,
        await flash(request, error(err, "Failed to generate billable items"))
      );
    }
    if (result.gated) {
      throw redirect(
        back,
        await flash(
          request,
          error(
            null,
            defaultUpgradeMessage(
              resolveRequirement({ feature: "PROJECT_REVENUE" })
            )
          )
        )
      );
    }
    generated = result.generated;
  } else {
    const result = await serverFns
      .as({ client, db, companyId, userId })
      .invoke("generate-contract-billable-items", {
        customerContractLineId: lineId,
        through
      });
    if (result.error) {
      logger.error("Failed to generate billable items", {
        companyId,
        lineId,
        error: result.error
      });
      throw redirect(
        back,
        await flash(
          request,
          error(
            result.error,
            getErrorMessage(result.error, "Failed to generate billable items")
          )
        )
      );
    }
    generated = result.data.generated;
  }

  throw redirect(
    back,
    await flash(
      request,
      success(
        generated === 1
          ? "1 billable item generated"
          : `${generated} billable items generated`
      )
    )
  );
}
