// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { Tabs, TabsList, TabsTrigger, VStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  type ActionFunctionArgs,
  data,
  type LoaderFunctionArgs,
  useLoaderData,
  useSearchParams
} from "react-router";
import Empty from "~/components/Empty";
import { usePermissions } from "~/hooks";
import {
  getContractBillableItems,
  getContractBillingLines,
  getTimesheetApprovals
} from "~/modules/projects/projects.service";
import ProjectBillableItemsTable from "~/modules/projects/ui/Billing/ProjectBillableItemsTable";
import TimesheetApprovals from "~/modules/projects/ui/Timesheet/TimesheetApprovals";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

const logger = getLogger("erp", "project-timesheet-approvals");

export const handle: Handle = {
  breadcrumb: msg`Approvals`,
  to: path.to.projectTimesheetApprovals,
  module: "projects"
};

export type ApprovalsTab = "time" | "billing";

/**
 * Two review queues: submitted time (`?tab=time`, the default) and the
 * contract billable items to review (`?tab=billing`, which was Projects →
 * Billing). Only the open tab's rows are read.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const searchParams = new URL(request.url).searchParams;
  const tab: ApprovalsTab =
    searchParams.get("tab") === "billing" ? "billing" : "time";

  // Billing review is contract billing: it also needs the sales permission.
  const { client, companyId } = await requirePermissions(
    request,
    tab === "billing"
      ? { update: "projects", view: "sales" }
      : { update: "projects" }
  );

  if (tab === "billing") {
    // With no status filter the list shows Unbilled and On Hold items.
    const { limit, offset, sorts, filters } =
      getGenericQueryFilters(searchParams);
    const hasStatusFilter = (filters ?? []).some(
      (filter) => filter.column === "status"
    );
    const [items, lines] = await Promise.all([
      getContractBillableItems(client, {
        companyId,
        status: hasStatusFilter ? null : ["Unbilled", "On Hold"],
        limit,
        offset,
        sorts,
        filters
      }),
      getContractBillingLines(client, { companyId })
    ]);
    if (items.error) {
      logger.error("Failed to load billable items", {
        companyId,
        error: items.error
      });
      throw redirect(
        path.to.projects,
        await flash(
          request,
          error(items.error, "Failed to load billable items")
        )
      );
    }
    if (lines.error) {
      logger.error("Failed to load contract billing lines", {
        companyId,
        error: lines.error
      });
    }
    return {
      tab,
      groups: [],
      billing: {
        items: items.data ?? [],
        count: items.count ?? 0,
        lines: lines.data ?? []
      }
    };
  }

  // A projects_update holder approves time on every project.
  const approvals = await getTimesheetApprovals(client, companyId, {
    ownerId: null
  });
  if (approvals.error) {
    logger.error("Failed to load timesheet approvals", {
      companyId,
      error: approvals.error
    });
  }

  return { tab, groups: approvals.data ?? [], billing: null };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const api = await carbon(request);
  const formData = await request.formData();
  const intent = formData.get("intent");
  const ids = formData
    .getAll("ids")
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  if (ids.length === 0) {
    return data(
      { success: false },
      await flash(request, error(null, "No entries were given"))
    );
  }

  if (intent === "approve") {
    const result = await api.projects.approveTimesheetEntries({ ids });
    if (result.error) {
      return data(
        { success: false },
        await flash(request, error(null, result.error.message))
      );
    }
    if (result.data.postingError) {
      return data(
        { success: false },
        await flash(
          request,
          error(
            null,
            `The time is approved but did not post: ${result.data.postingError}`
          )
        )
      );
    }
    return data(
      { success: true },
      await flash(request, success("Time approved and posted"))
    );
  }

  if (intent === "reject") {
    const note = String(formData.get("note") ?? "").trim();
    if (!note) {
      return data(
        { success: false },
        await flash(request, error(null, "A note is required to reject time"))
      );
    }
    const result = await api.projects.rejectTimesheetEntries({ ids, note });
    if (result.error) {
      return data(
        { success: false },
        await flash(request, error(null, result.error.message))
      );
    }
    return data(
      { success: true },
      await flash(request, success("Time rejected"))
    );
  }

  return data(
    { success: false },
    await flash(request, error(null, "Unknown action"))
  );
}

export default function ProjectTimesheetApprovalsRoute() {
  const { t } = useLingui();
  const { tab, groups, billing } = useLoaderData<typeof loader>();
  const [, setSearchParams] = useSearchParams();
  const permissions = usePermissions();
  const canReviewBilling = permissions.can("view", "sales");

  const projects = new Map<string, string>();
  for (const item of billing?.items ?? []) {
    if (item.project)
      projects.set(
        item.project.id,
        item.project.identifier ?? item.project.name
      );
  }

  return (
    <VStack spacing={0} className="h-full">
      <div className="flex w-full shrink-0 items-center gap-4 px-4 pt-4 pb-2">
        <h2 className="text-base font-medium">
          <Trans>Approvals</Trans>
        </h2>
        {/* Without the sales permission there is no Billing tab, and a
            single Time tab is no choice: no tabs at all. */}
        {canReviewBilling && (
          <Tabs
            value={tab}
            onValueChange={(value) =>
              // A tab starts with its own filters.
              setSearchParams(value === "billing" ? { tab: "billing" } : {})
            }
          >
            <TabsList>
              <TabsTrigger value="time">
                <Trans>Time</Trans>
              </TabsTrigger>
              <TabsTrigger value="billing">
                <Trans>Billing</Trans>
              </TabsTrigger>
            </TabsList>
          </Tabs>
        )}
      </div>
      {billing ? (
        <ProjectBillableItemsTable
          data={billing.items}
          count={billing.count}
          projects={[...projects].map(([value, label]) => ({ value, label }))}
          lines={billing.lines.map((line) => ({
            value: line.id,
            label: `${line.contract?.customerContractId ?? ""} · ${
              line.description || line.item?.name || line.id
            }`
          }))}
          emptyState={
            <Empty
              title={t`Nothing to review`}
              description={t`This list shows Unbilled and On Hold items only.`}
            />
          }
        />
      ) : (
        <TimesheetApprovals groups={groups} />
      )}
    </VStack>
  );
}
