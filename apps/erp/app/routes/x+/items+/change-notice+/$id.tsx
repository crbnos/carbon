// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { authorize } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { getDocumentApprovalState } from "@carbon/ee/approvals/document.server";
import { getLogger } from "@carbon/logger";
import { RecordOutlet } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData, useParams } from "react-router";
import { PanelProvider, ResizablePanels } from "~/components/Layout/Panels";
import {
  getChangeNotice,
  getChangeNoticeActions,
  getChangeNoticeAffectedItems,
  getChangeNoticeDiff,
  getChangeNoticeRequiredActionsList,
  getChangeNoticeTypesList,
  getItemsUsedIn
} from "~/modules/items/items.service";
import type { AffectedItemListEntry } from "~/modules/items/ui/ChangeNotice";
import {
  ChangeNoticeExplorer,
  ChangeNoticeHeader,
  ChangeNoticeProperties
} from "~/modules/items/ui/ChangeNotice";
import { getIssue, getIssues } from "~/modules/quality/quality.service";
import type { Handle } from "~/utils/handle";
import { recordMeta } from "~/utils/meta";
import { path } from "~/utils/path";

const logger = getLogger("erp", "change-notice");

export const handle: Handle = {
  // Leaf crumb: show the CO's readable number (from loader data), not a second
  // static "Change Notices" (the parent _layout already renders the list crumb).
  breadcrumb: (
    _params: unknown,
    data?: { changeNotice?: { changeOrderId?: string } }
  ) => data?.changeNotice?.changeOrderId ?? msg`Change Notice`,
  // The CO detail workspace has its own left affected-items sidebar — hide the
  // Items module sidebar here so two left sidebars don't stack.
  hideModuleSidebar: true
};

export const meta: MetaFunction<typeof loader> = ({ data }) =>
  recordMeta(data?.changeNotice?.changeOrderId, "Change Notice");

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await authorize(request, {
    "parts.changeNotices": "View"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const [
    changeNotice,
    types,
    affected,
    diff,
    actions,
    nonConformances,
    requiredActionsList
  ] = await Promise.all([
    getChangeNotice(client, id, companyId),
    getChangeNoticeTypesList(client, companyId),
    getChangeNoticeAffectedItems(client, id, companyId),
    getChangeNoticeDiff(client, id, companyId),
    getChangeNoticeActions(client, id, companyId),
    // NCR cross-link picker options (4a).
    getIssues(client, companyId),
    // Active default-action templates for the "Add Actions" picker.
    getChangeNoticeRequiredActionsList(client, companyId)
  ]);

  const requiredActions = requiredActionsList.data ?? [];

  if (changeNotice.error) {
    throw redirect(
      path.to.changeNotices,
      await flash(
        request,
        error(changeNotice.error, "Failed to load change notice")
      )
    );
  }

  // Human label for the currently-linked NCR (so the sidebar link shows the
  // readable id/name, not the raw id).
  const linkedNonConformanceId = changeNotice.data?.nonConformanceId ?? null;
  const linkedNonConformancePromise = linkedNonConformanceId
    ? getIssue(client, linkedNonConformanceId).then((issue) => issue.data)
    : null;

  const affectedRows = affected.data ?? [];

  // Impact = where each affected item is used across the system (jobs, POs,
  // sales, receipts, methods, NCRs, …), the part page's "Used In" data. Streamed:
  // only the impact panel reads it.
  const impactUsedIn = getItemsUsedIn(
    client,
    affectedRows.map((a) => a.itemId),
    companyId
  ).then(({ data, error }) => {
    if (error) {
      logger.error("Failed to load change notice impact", {
        companyId,
        changeNoticeId: id,
        error
      });
      return [];
    }
    return affectedRows.flatMap((a) => {
      const usedIn = data.get(a.itemId);
      return usedIn
        ? [
            {
              itemId: a.itemId,
              readableIdWithRevision:
                a.item?.readableIdWithRevision ?? a.itemId,
              itemName: a.item?.name ?? null,
              usedIn
            }
          ]
        : [];
    });
  });

  const diffByAffectedId = new Map(
    (diff.data?.items ?? []).map((entry) => [entry.affectedItemId, entry])
  );

  // Each item's draft is loaded by its own route ($id.$affectedId.details).
  const affectedItems: AffectedItemListEntry[] = affectedRows.map(
    (affectedItem) => ({
      affectedItem,
      diff: diffByAffectedId.get(affectedItem.id)
    })
  );

  // Minimal, explicit option shape (cheap type — avoids widening the loader's
  // instantiation surface with the full issues-view row).
  const nonConformanceOptions: {
    id: string;
    nonConformanceId: string;
    name: string;
  }[] = (nonConformances.data ?? []).flatMap((nc) =>
    nc.id && nc.nonConformanceId
      ? [
          {
            id: nc.id,
            nonConformanceId: nc.nonConformanceId,
            name: nc.name ?? ""
          }
        ]
      : []
  );

  // Approval only gates Engineering Complete → Implementation.
  const [linkedNonConformance, approval] = await Promise.all([
    linkedNonConformancePromise,
    changeNotice.data?.status === "Engineering Complete"
      ? getDocumentApprovalState(getCarbonServiceRole(), {
          documentType: "changeOrder",
          documentId: id,
          companyId,
          userId
        })
      : null
  ]);

  return {
    changeNotice: changeNotice.data,
    types: types.data ?? [],
    affectedItems,
    diff: diff.data ?? { items: [] },
    actions: actions.data ?? [],
    requiredActions,
    impactUsedIn,
    nonConformanceOptions,
    approval,
    linkedNonConformance: linkedNonConformance
      ? {
          id: linkedNonConformance.id,
          nonConformanceId: linkedNonConformance.nonConformanceId,
          name: linkedNonConformance.name
        }
      : null
  };
}

export default function ChangeNoticeIdRoute() {
  const { t } = useLingui();
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");
  // Surfaced to child routes + header/explorer/properties via useRouteData.
  useLoaderData<typeof loader>();

  return (
    // Standard 3-pane detail workspace (matches sales-order / job): the explorer
    // is the affected-items list, the content is the selected affected item's
    // detail (the $id.details Outlet, with the CO-wide stage flow + actions on
    // top), and the properties panel holds the CO-centric fields, details,
    // actions, impact, and the release dialog.
    <PanelProvider>
      <div className="flex flex-col h-[calc(100dvh-var(--topbar-height)-var(--content-inset))] overflow-hidden w-full">
        <ChangeNoticeHeader />
        <div className="flex h-[calc(100dvh-var(--topbar-height)-var(--header-height)-var(--content-inset))] overflow-hidden w-full">
          <div className="flex flex-grow overflow-hidden">
            <ResizablePanels
              explorerLabel={t`Affected Items`}
              explorer={<ChangeNoticeExplorer />}
              content={
                <div className="bg-card h-[calc(100dvh-var(--topbar-height)-var(--header-height)-var(--content-inset))] overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent w-full">
                  <RecordOutlet />
                </div>
              }
              properties={<ChangeNoticeProperties key={id} />}
            />
          </div>
        </div>
      </div>
    </PanelProvider>
  );
}
