// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getCompanyTimeZone } from "@carbon/database";
import { getLogger } from "@carbon/logger";
import { datetime } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import {
  buildMspdiXml,
  parsePlanSnapshot
} from "~/modules/projects/projects.models";
import { loadWbsElements } from "~/modules/projects/projects.service";
import { getDatabaseClient } from "~/services/database.server";

const logger = getLogger("erp", "project-mspdi");

/**
 * GET — a project's WBS as Microsoft Project XML, with the latest baseline
 * that has dates (format version 2 or later) as Baseline 0. Refused with 422
 * while 2 elements share a code.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "projects",
    role: "employee"
  });
  const { projectId } = params;
  if (!projectId) {
    throw new Response("The project could not be found", { status: 404 });
  }

  const db = getDatabaseClient();
  const [project, company, flags, baseline, wbs, timeZone] = await Promise.all([
    client
      .from("project")
      .select("identifier, name")
      .eq("id", projectId)
      .eq("companyId", companyId)
      .maybeSingle(),
    client
      .from("company")
      .select("baseCurrencyCode")
      .eq("id", companyId)
      .single(),
    db
      .selectFrom("projectElement")
      .select(["id", "isControlAccount", "earnedValueTechnique"])
      .where("projectId", "=", projectId)
      .where("companyId", "=", companyId)
      .where((eb) =>
        eb.or([
          eb("isControlAccount", "=", true),
          eb("earnedValueTechnique", "is not", null)
        ])
      )
      .execute(),
    db
      .selectFrom("projectBaseline")
      .select(["snapshot"])
      .where("projectId", "=", projectId)
      .where("companyId", "=", companyId)
      .where("formatVersion", ">=", 2)
      .orderBy("sequence", "desc")
      .limit(1)
      .executeTakeFirst(),
    loadWbsElements(db, { companyId, projectId }),
    getCompanyTimeZone(client, companyId)
  ]);
  if (project.error || !project.data) {
    logger.error("Failed to load the project", {
      companyId,
      projectId,
      error: project.error
    });
    throw new Response("The project could not be found", { status: 404 });
  }

  let baselineById: Map<
    string,
    {
      startDate: string | null;
      targetDate: string | null;
      budget: number | null;
    }
  > | null = null;
  if (baseline) {
    const snapshot = parsePlanSnapshot(baseline.snapshot);
    const budgets = new Map(
      snapshot.elements.map((row) => [
        String(row.id),
        row.budget == null ? null : Number(row.budget)
      ])
    );
    baselineById = new Map(
      (snapshot.schedule ?? []).map((row) => [
        row.id,
        {
          startDate: row.startDate,
          targetDate: row.targetDate,
          budget: budgets.get(row.id) ?? null
        }
      ])
    );
  }

  let xml: string;
  try {
    xml = buildMspdiXml({
      project: {
        identifier: project.data.identifier ?? "",
        name: project.data.name,
        currencyCode: company.data?.baseCurrencyCode ?? "USD"
      },
      elements: wbs.elements,
      links: wbs.links,
      controlAccountIds: new Set(
        flags.filter((row) => row.isControlAccount).map((row) => row.id)
      ),
      workPackageIds: new Set(
        flags.filter((row) => row.earnedValueTechnique).map((row) => row.id)
      ),
      baseline: baselineById,
      today: datetime.today(timeZone).toString()
    });
  } catch (err) {
    logger.error("The WBS has repeated codes", {
      companyId,
      projectId,
      error: err
    });
    throw new Response(
      err instanceof Error ? err.message : "The WBS has repeated codes",
      { status: 422 }
    );
  }

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="${project.data.identifier ?? "project"}.xml"`
    }
  });
}
