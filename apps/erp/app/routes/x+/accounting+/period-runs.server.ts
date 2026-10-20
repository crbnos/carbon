// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The two period runs on one engine — revenue recognition and lease runs
// (spec `.ai/specs/2026-10-11-lessee-leases.md` §6) — share their list loader
// and their "New run" action. Each takes the run type.

import { carbon, respond } from "@carbon/api/carbon.server";
import type { RunType } from "@carbon/database/run-type";
import { runLabelSentence } from "@carbon/database/run-type";
import { validator } from "@carbon/form";
import { datetime } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { existingDraftRunId } from "~/modules/accounting/accounting.service";
import { getNextRevenueRecognitionPeriodEnd } from "~/modules/accounting/accounting.utils";
import { RUN_PAGES } from "~/modules/accounting/ui/RevenueRecognition/runPages";
import { getCompanyTimeZone } from "~/modules/shared/shared.service";
import { periodRunsLists } from "~/utils/list-registry/accounting.server";
import { loadListPage } from "~/utils/list-registry/load.server";
import { path } from "~/utils/path";

const newRunForm = z.object({ periodEnd: z.string().optional() });

export async function loadPeriodRuns(request: Request, type: RunType) {
  return loadListPage(request, periodRunsLists[type], {
    dataKey: "data",
    firstPage: async ({ client, companyId }) => {
      const lastRun = await client
        .from("revenueRecognitionRun")
        .select("periodEnd, status")
        .eq("companyId", companyId)
        .eq("type", type)
        .order("periodEnd", { ascending: false })
        .limit(1);

      const lastRunData =
        lastRun.data && lastRun.data.length > 0 ? lastRun.data[0] : null;
      // The proposed period: the month after the last run, or the month just
      // closed in the company's calendar when there is no run yet.
      const nextPeriodEnd = getNextRevenueRecognitionPeriodEnd(
        lastRunData?.periodEnd ?? null,
        datetime.today(await getCompanyTimeZone(client, companyId)).toString()
      );
      return {
        nextPeriodEnd,
        hasDraftBlocking: lastRunData?.status === "Draft"
      };
    }
  });
}

/** The list pages' New Run: the period the page showed, or with a bare POST
 *  the month after the last run of the type. */
export async function createPeriodRun(args: ActionFunctionArgs, type: RunType) {
  const input = await validator(newRunForm).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.accounting.createRevenueRecognitionRun({
    type,
    periodEnd: input.data.periodEnd || undefined
  });
  const draftRunId = existingDraftRunId(result.error);
  return respond(args.request, result).redirect(
    result.data
      ? path.to.revenueRecognitionRun(result.data.id)
      : RUN_PAGES[type].listPath,
    {
      message: `${runLabelSentence(type)} created`,
      onError: draftRunId
        ? path.to.revenueRecognitionRun(draftRunId)
        : undefined
    }
  );
}
