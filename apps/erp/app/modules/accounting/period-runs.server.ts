// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The two period runs on one engine — revenue recognition and lease runs
// (spec `.ai/specs/2026-10-11-lessee-leases.md` §6) — share their list loader
// and their "New run" action. Each takes the run type.

import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  RUN_LABEL,
  type RunType,
  runLabelSentence
} from "@carbon/database/run-type";
import { validator } from "@carbon/form";
import { serverFns } from "@carbon/server-functions";
import { datetime, redirect } from "@carbon/utils";
import { endOfMonth, parseDate } from "@internationalized/date";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";
import { getCompanyTimeZone } from "../shared/timezone.server";
import { revenueRecognitionRunValidator } from "./accounting.models";
import { futureRunPeriodError } from "./accounting.server";
import { getRevenueRecognitionRuns } from "./accounting.service";
import { getNextRevenueRecognitionPeriodEnd } from "./accounting.utils";
import { RUN_PAGES } from "./ui/RevenueRecognition/runPages";

export async function loadPeriodRuns(request: Request, type: RunType) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [runs, lastRun] = await Promise.all([
    getRevenueRecognitionRuns(client, companyId, type, {
      search,
      limit,
      offset,
      sorts,
      filters
    }),
    client
      .from("revenueRecognitionRun")
      .select("periodEnd, status")
      .eq("companyId", companyId)
      .eq("type", type)
      .order("periodEnd", { ascending: false })
      .limit(1)
  ]);

  const lastRunData =
    lastRun.data && lastRun.data.length > 0 ? lastRun.data[0] : null;
  // The proposed period: the month after the last run, or the month just
  // closed in the company's calendar when there is no run yet.
  const nextPeriodEnd = getNextRevenueRecognitionPeriodEnd(
    lastRunData?.periodEnd ?? null,
    datetime.today(await getCompanyTimeZone(client, companyId)).toString()
  );
  const hasDraftBlocking = lastRunData?.status === "Draft";

  return {
    data: runs.data ?? [],
    count: runs.count ?? 0,
    nextPeriodEnd,
    hasDraftBlocking
  };
}

export async function proposePeriodRun(
  request: Request,
  type: RunType
): Promise<never> {
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "accounting"
  });
  const { listPath } = RUN_PAGES[type];
  const label = RUN_LABEL[type];

  // The list page posts the period it showed; a bare POST falls back to the
  // period after the last run of the type (posted or draft).
  const formData = await request.formData();
  const validation = await validator(revenueRecognitionRunValidator).validate(
    formData
  );

  let periodEnd: string;
  if (validation.error) {
    const lastRun = await client
      .from("revenueRecognitionRun")
      .select("periodEnd")
      .eq("companyId", companyId)
      .eq("type", type)
      .order("periodEnd", { ascending: false })
      .limit(1);

    const lastPeriodEnd =
      lastRun.data && lastRun.data.length > 0
        ? lastRun.data[0].periodEnd
        : null;

    periodEnd = getNextRevenueRecognitionPeriodEnd(
      lastPeriodEnd,
      datetime.today(await getCompanyTimeZone(client, companyId)).toString()
    );
  } else {
    // Schedule rows fall on month ends, so a picked day means its month: a
    // mid-month date would leave that month's rows out. Depreciation runs
    // snap the same way.
    periodEnd = endOfMonth(
      parseDate(validation.data.periodEnd.slice(0, 10))
    ).toString();
  }

  const futureError = await futureRunPeriodError(client, companyId, periodEnd);
  if (futureError) {
    throw redirect(listPath, await flash(request, error(null, futureError)));
  }

  // A period can have more than one run of a type (a second picks up rows
  // that fell due after the first posted), but only one Draft at a time.
  const existingDraft = await client
    .from("revenueRecognitionRun")
    .select("id, runId")
    .eq("periodEnd", periodEnd)
    .eq("companyId", companyId)
    .eq("type", type)
    .eq("status", "Draft")
    .maybeSingle();

  if (existingDraft.data) {
    throw redirect(
      path.to.revenueRecognitionRun(existingDraft.data.id),
      await flash(
        request,
        error(
          null,
          `${existingDraft.data.runId} is already a draft for this period. Recalculate it instead.`
        )
      )
    );
  }

  try {
    const proposal = await serverFns
      .system({ db: getDatabaseClient(), companyId, userId })
      .invokeOrThrow("propose-revenue-recognition-run", { periodEnd, type });

    if (!proposal) {
      throw redirect(
        listPath,
        await flash(request, error(null, "Nothing to post for this period"))
      );
    }

    throw redirect(
      path.to.revenueRecognitionRun(proposal.id),
      await flash(request, success(`${runLabelSentence(type)} created`))
    );
  } catch (e) {
    if (e instanceof Response) throw e;
    throw redirect(
      listPath,
      await flash(request, error(e, `Failed to create ${label}`))
    );
  }
}
