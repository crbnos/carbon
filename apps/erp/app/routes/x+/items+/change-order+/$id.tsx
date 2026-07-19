import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { JSONContent } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData, useParams } from "react-router";
import { PanelProvider, ResizablePanels } from "~/components/Layout/Panels";
import {
  getChangeOrder,
  getChangeOrderActions,
  getChangeOrderAffectedItems,
  getChangeOrderDiff,
  getChangeOrderRequiredActionsList,
  getChangeOrderTypesList,
  getConfigurationParameters,
  getConfigurationRules,
  getItemFiles,
  getItemManufacturing,
  getMakeMethodById,
  getMakeMethods,
  getMethodMaterialsByMakeMethod,
  getMethodOperationsByMakeMethodId,
  getPart,
  getPartUsedIn,
  getPickMethods,
  getSupplierParts
} from "~/modules/items";
import { getRevisionLock } from "~/modules/items/items.server";
import type { AffectedItemDraft } from "~/modules/items/ui/ChangeOrder";
import {
  ChangeOrderExplorer,
  ChangeOrderHeader,
  ChangeOrderProperties
} from "~/modules/items/ui/ChangeOrder";
import { getIssue, getIssues } from "~/modules/quality";
import { getLocationsList } from "~/modules/resources";
import type { MethodItemType, MethodType } from "~/modules/shared";
import { getTagsList } from "~/modules/shared";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  // Leaf crumb: show the CO's readable number (from loader data), not a second
  // static "Change Orders" (the parent _layout already renders the list crumb).
  breadcrumb: (
    _params: unknown,
    data?: { changeOrder?: { changeOrderId?: string } }
  ) => data?.changeOrder?.changeOrderId ?? msg`Change Order`,
  module: "parts",
  // The CO detail workspace has its own left affected-items sidebar — hide the
  // Items module sidebar here so two left sidebars don't stack.
  hideModuleSidebar: true
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const [changeOrder, types, affected, diff, actions, nonConformances] =
    await Promise.all([
      getChangeOrder(client, id, companyId),
      getChangeOrderTypesList(client, companyId),
      getChangeOrderAffectedItems(client, id, companyId),
      getChangeOrderDiff(client, id, companyId),
      getChangeOrderActions(client, id, companyId),
      // NCR cross-link picker options (4a).
      getIssues(client, companyId)
    ]);

  // Company locations feed the embedded PartProperties pick-method editor.
  const locations = (await getLocationsList(client, companyId)).data ?? [];

  // Active default-action templates for the "Add Actions" picker.
  const requiredActions =
    (await getChangeOrderRequiredActionsList(client, companyId)).data ?? [];

  if (changeOrder.error) {
    throw redirect(
      path.to.changeOrders,
      await flash(
        request,
        error(changeOrder.error, "Failed to load change order")
      )
    );
  }

  // Human label for the currently-linked NCR (so the sidebar link shows the
  // readable id/name, not the raw id).
  const linkedNonConformanceId = changeOrder.data?.nonConformanceId ?? null;
  const linkedNonConformance = linkedNonConformanceId
    ? (await getIssue(client, linkedNonConformanceId)).data
    : null;

  const affectedRows = affected.data ?? [];

  // Impact = where each affected item is used across the system (jobs, POs,
  // sales, receipts, methods, NCRs, …) — the same "Used In" data the part detail
  // page loads, one entry per affected item.
  const impactUsedIn = await Promise.all(
    affectedRows.map(async (a) => ({
      itemId: a.itemId,
      readableIdWithRevision: a.item?.readableIdWithRevision ?? a.itemId,
      itemName: a.item?.name ?? null,
      usedIn: await getPartUsedIn(client, a.itemId, companyId)
    }))
  );

  const diffByAffectedId = new Map(
    (diff.data?.items ?? []).map((entry) => [entry.affectedItemId, entry])
  );

  // Per affected item: load its CO-owned Draft make method's real rows shaped
  // exactly as the embedded BillOfMaterial / BillOfProcess editors expect (same
  // assembly as x+/part+/$itemId.make.$makeMethodId). The draft lives on the
  // same item for a Version, or on the new item (newItemId) for Revision/New Part.
  const affectedItems: AffectedItemDraft[] = await Promise.all(
    affectedRows.map(async (affectedItem) => {
      const draftItemId = affectedItem.newItemId ?? affectedItem.itemId;
      const draftMakeMethodId = affectedItem.draftMakeMethodId;

      if (!draftMakeMethodId) {
        return {
          affectedItem,
          draftItemId,
          makeMethod: null,
          methodMaterials: [],
          methodOperations: [],
          tags: [],
          configurable: false,
          configurationRules: [],
          parameters: [],
          revisionStatus: null,
          releaseControl: null,
          partData: null,
          diff: diffByAffectedId.get(affectedItem.id)
        };
      }

      // Revision / Replacement Part / New Part edit the item's attributes + files
      // on the draft item — load the same bundle the part detail route feeds
      // PartProperties, embedded on the CO card. Parts only (Tool attribute
      // editing is a follow-up); Version has no attribute editing (Q2 matrix).
      const needsAttributes =
        (affectedItem.changeType === "Revision" ||
          affectedItem.changeType === "Replacement Part" ||
          affectedItem.changeType === "New Part") &&
        affectedItem.item?.type === "Part";
      let partData = null;
      if (needsAttributes) {
        const [partSummary, supplierParts, pickMethods, partTags] =
          await Promise.all([
            getPart(client, draftItemId, companyId),
            getSupplierParts(client, draftItemId, companyId),
            getPickMethods(client, draftItemId, companyId),
            getTagsList(client, companyId, "part")
          ]);
        if (partSummary.data) {
          partData = {
            itemId: draftItemId,
            locations,
            partSummary: partSummary.data,
            files: getItemFiles(client, draftItemId, companyId),
            supplierParts: supplierParts.data ?? [],
            pickMethods: pickMethods.data ?? [],
            makeMethods: getMakeMethods(client, draftItemId, companyId),
            tags: partTags.data ?? []
          };
        }
      }

      const [
        makeMethod,
        methodMaterials,
        methodOperations,
        tags,
        manufacturing,
        revisionLock
      ] = await Promise.all([
        getMakeMethodById(client, draftMakeMethodId, companyId),
        getMethodMaterialsByMakeMethod(client, draftMakeMethodId),
        getMethodOperationsByMakeMethodId(client, draftMakeMethodId),
        getTagsList(client, companyId, "operation"),
        getItemManufacturing(client, draftItemId, companyId),
        getRevisionLock(client, { itemId: draftItemId, companyId })
      ]);

      const config = manufacturing.data?.requiresConfiguration
        ? {
            parameters: (
              await getConfigurationParameters(client, draftItemId, companyId)
            ).parameters,
            configurationRules: await getConfigurationRules(
              client,
              draftItemId,
              companyId
            )
          }
        : {
            parameters: [] as Awaited<
              ReturnType<typeof getConfigurationParameters>
            >["parameters"],
            configurationRules: [] as Awaited<
              ReturnType<typeof getConfigurationRules>
            >
          };

      return {
        affectedItem,
        draftItemId,
        makeMethod: makeMethod.data ?? null,
        methodMaterials:
          methodMaterials.data?.map((m) => ({
            ...m,
            description: m.item?.name ?? "",
            methodOperationId: m.methodOperationId ?? undefined,
            methodType: m.methodType as MethodType,
            itemType: m.itemType as MethodItemType
          })) ?? [],
        methodOperations:
          methodOperations.data?.map((operation) => ({
            ...operation,
            description: operation.description ?? "",
            procedureId: operation.procedureId ?? undefined,
            operationSupplierProcessId:
              operation.operationSupplierProcessId ?? undefined,
            operationMinimumCost: operation.operationMinimumCost ?? 0,
            operationLeadTime: operation.operationLeadTime ?? 0,
            operationUnitCost: operation.operationUnitCost ?? 0,
            tags: operation.tags ?? [],
            workCenterId: operation.workCenterId ?? undefined,
            workInstruction: operation.workInstruction as JSONContent | null
          })) ?? [],
        tags: tags.data ?? [],
        configurable: manufacturing.data?.requiresConfiguration ?? false,
        configurationRules: config.configurationRules,
        parameters: config.parameters,
        revisionStatus: revisionLock.revisionStatus,
        releaseControl: revisionLock.releaseControl,
        partData,
        diff: diffByAffectedId.get(affectedItem.id)
      };
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

  return {
    changeOrder: changeOrder.data,
    types: types.data ?? [],
    affectedItems,
    diff: diff.data ?? { items: [] },
    actions: actions.data ?? [],
    requiredActions,
    impactUsedIn,
    nonConformanceOptions,
    linkedNonConformance: linkedNonConformance
      ? {
          id: linkedNonConformance.id,
          nonConformanceId: linkedNonConformance.nonConformanceId,
          name: linkedNonConformance.name
        }
      : null
  };
}

export default function ChangeOrderIdRoute() {
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
      <div className="flex flex-col h-[calc(100dvh-49px)] overflow-hidden w-full">
        <ChangeOrderHeader />
        <div className="flex h-[calc(100dvh-99px)] overflow-hidden w-full">
          <div className="flex flex-grow overflow-hidden">
            <ResizablePanels
              explorer={<ChangeOrderExplorer />}
              content={
                <div className="h-[calc(100dvh-99px)] overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent w-full">
                  <Outlet />
                </div>
              }
              properties={<ChangeOrderProperties key={id} />}
            />
          </div>
        </div>
      </div>
    </PanelProvider>
  );
}
