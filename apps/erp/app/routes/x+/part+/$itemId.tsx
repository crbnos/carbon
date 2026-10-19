// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { dataOrThrow } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { authorize } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { ITEM_PAGES } from "@carbon/database/access";
import {
  HStack,
  Input,
  InputGroup,
  InputLeftElement,
  RecordOutlet,
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useRouteData
} from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Suspense, useState } from "react";
import { LuSearch } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { Await, useLoaderData, useParams } from "react-router";
import { ResizablePanels } from "~/components/Layout";
import { flattenTree } from "~/components/TreeView";
import { isChangeNoticeOpen } from "~/modules/items/items.models";
import {
  findChangeNoticesForItemOnce,
  getMakeMethodByIdOnce,
  getMakeMethodsOnce,
  getUnreleasedChangeOrderForItem,
  streamItemSupersession
} from "~/modules/items/items.service";
import type { ItemFile, Method, PartSummary } from "~/modules/items/types";
import {
  BoMActions,
  BoMExplorer,
  SelectedItemProperties
} from "~/modules/items/ui/Item";
import type { UsedInNode } from "~/modules/items/ui/Item/UsedIn";
import {
  changeNoticesUsedInNode,
  UsedInSkeleton,
  UsedInTree
} from "~/modules/items/ui/Item/UsedIn";
import { PartHeader, PartProperties } from "~/modules/items/ui/Parts";
import { detailBreadcrumb, type Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  appBarSubtitle: msg`Part`,
  breadcrumb: detailBreadcrumb(
    { breadcrumb: msg`Parts`, to: path.to.parts },
    (data) => data?.partSummary?.readableIdWithRevision
  ),
  module: "items"
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, api } = await authorize(
    request,
    { "parts.parts": "View" },
    { bypassRls: true }
  );

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const { supersession, supersededBy } = streamItemSupersession(
    client,
    itemId,
    companyId
  );

  const [
    partSummary,
    supplierParts,
    pickMethods,
    tags,
    allChangeNotices,
    unreleasedChangeOrder
  ] = await Promise.all([
    api.items.getPart({ itemId }),
    api.items.getSupplierParts({ id: itemId }),
    api.items.getPickMethods({ itemId }),
    api.shared.getTagsList({ table: "part" }),
    // Every CO, any status; the open subset (which locks manual version/revision
    // creation) is derived below.
    findChangeNoticesForItemOnce(client, { itemId, companyId }),
    // Locks the Active toggle while the change notice that minted this item is
    // still open — release is what activates it.
    getUnreleasedChangeOrderForItem(client, { itemId, companyId })
  ]);

  if (partSummary.data?.companyId !== companyId) {
    throw redirect(path.to.items);
  }

  if (partSummary.error) {
    throw redirect(
      path.to.items,
      await flash(
        request,
        error(partSummary.error, "Failed to load part summary")
      )
    );
  }

  const changeNotices = allChangeNotices.data ?? [];
  const openChangeNotices = changeNotices.filter((cn) =>
    isChangeNoticeOpen(cn.status)
  );

  const url = new URL(request.url);
  const requestedMethodId = url.searchParams.get("methodId");

  // One query, two consumers: `methodTree` derives from it and the raw list is
  // also deferred to the client. Calling getMakeMethods twice issued the same
  // query twice on every part-detail load.
  const makeMethodsPromise = getMakeMethodsOnce(client, itemId, companyId);

  const methodTree = makeMethodsPromise.then(async (makeMethods) => {
    // Include CO-owned drafts so a revision/new-part item created by an open
    // Change Notice shows its method tree on the item master, in sync with the
    // CO (same makeMethod). Active is still preferred as the default below.
    const selectable = makeMethods.data ?? [];
    const makeMethod = requestedMethodId
      ? (selectable.find((m) => m.id === requestedMethodId) ??
        selectable.find((m) => m.status === "Active") ??
        selectable[0])
      : (selectable.find((m) => m.status === "Active") ?? selectable[0]);
    if (!makeMethod) return null;

    const fullMethod = await getMakeMethodByIdOnce(
      client,
      makeMethod.id,
      companyId
    );
    if (fullMethod.error || !fullMethod.data) return null;

    const tree = await api.items.getMethodTree({
      makeMethodId: fullMethod.data.id
    });
    if (tree.error) return null;

    const methods =
      tree.data.length > 0 ? flattenTree<Method>(tree.data[0]) : [];

    return {
      makeMethod: fullMethod.data,
      methods
    };
  });

  return {
    partSummary: partSummary.data,
    supersession,
    supersededBy,
    files: api.items.getItemFiles({ itemId }).then(dataOrThrow),
    supplierParts: supplierParts.data ?? [],
    pickMethods: pickMethods.data ?? [],
    makeMethods: makeMethodsPromise,
    tags: tags.data ?? [],
    usedIn: api.items.getPartUsedIn({ itemId }).then(dataOrThrow),
    methodTree,
    changeNotices,
    openChangeNotices,
    // Fail closed: a lookup we couldn't read can't prove the item is CO-free.
    changeNoticesUnavailable: allChangeNotices.error !== null,
    unreleasedChangeOrder
  };
}

export default function PartRoute() {
  const { t } = useLingui();
  const { itemId } = useParams();
  if (!itemId) throw new Error("Could not find itemId");

  const partData = useRouteData<{
    partSummary: PartSummary;
    files: Promise<ItemFile[]>;
  }>(path.to.part(itemId));

  if (!partData) throw new Error("Could not find part data");

  const { usedIn, methodTree, changeNotices } = useLoaderData<typeof loader>();

  const isManufactured = partData.partSummary?.replenishmentSystem !== "Buy";

  const [filterText, setFilterText] = useState("");

  return (
    <div className="flex flex-col h-[calc(100dvh-var(--topbar-height)-var(--content-inset))] overflow-hidden w-full">
      <PartHeader key={itemId} />
      <div className="flex h-[calc(100dvh-var(--topbar-height)-var(--header-height)-var(--content-inset))] overflow-hidden w-full">
        <div className="flex flex-grow overflow-hidden">
          <ResizablePanels
            explorerLabel={isManufactured ? t`Manufacturing` : t`Used In`}
            explorer={
              <div className="flex flex-col h-full">
                {isManufactured ? (
                  <Tabs
                    defaultValue="manufacturing"
                    className="flex flex-col h-full"
                  >
                    <div className="px-2 pt-2 flex-shrink-0">
                      <TabsList className="grid grid-cols-2 w-full">
                        <TabsTrigger value="manufacturing">
                          <Trans>Manufacturing</Trans>
                        </TabsTrigger>
                        <TabsTrigger value="used-in">
                          <Trans>Used In</Trans>
                        </TabsTrigger>
                      </TabsList>
                    </div>
                    <HStack className="w-full justify-between flex-shrink-0 p-2 pb-0">
                      <InputGroup size="sm" className="flex flex-grow">
                        <InputLeftElement>
                          <LuSearch className="h-4 w-4" />
                        </InputLeftElement>
                        <Input
                          placeholder={t`Search...`}
                          value={filterText}
                          onChange={(e) => setFilterText(e.target.value)}
                        />
                      </InputGroup>
                      <Suspense fallback={null}>
                        <Await resolve={methodTree}>
                          {(resolved) =>
                            resolved ? (
                              <BoMActions
                                makeMethodId={resolved.makeMethod.id}
                              />
                            ) : null
                          }
                        </Await>
                      </Suspense>
                    </HStack>
                    <div className="flex-1 overflow-y-auto">
                      <TabsContent value="manufacturing">
                        <Suspense
                          fallback={
                            <div className="flex w-full items-center justify-center p-4">
                              <Spinner className="h-6 w-6" />
                            </div>
                          }
                        >
                          <Await resolve={methodTree}>
                            {(resolved) =>
                              resolved ? (
                                <div className="w-full p-2">
                                  <BoMExplorer
                                    itemType="Part"
                                    makeMethod={resolved.makeMethod}
                                    methods={resolved.methods}
                                    methodId={resolved.makeMethod.id}
                                    filterText={filterText}
                                    hideSearch
                                  />
                                </div>
                              ) : null
                            }
                          </Await>
                        </Suspense>
                      </TabsContent>
                      <TabsContent value="used-in">
                        <Suspense fallback={<UsedInSkeleton />}>
                          <Await resolve={usedIn}>
                            {(resolvedUsedIn) => {
                              const {
                                issues,
                                jobMaterials,
                                jobs,
                                maintenanceDispatchItems,
                                methodMaterials,
                                purchaseOrderLines,
                                receiptLines,
                                quoteLines,
                                quoteMaterials,
                                salesOrderLines,
                                shipmentLines,
                                supplierQuotes,
                                assemblyInstructions,
                                inspections,
                                jobMaterialUsage
                              } = resolvedUsedIn;

                              const tree: UsedInNode[] = [
                                {
                                  key: "issues",
                                  name: t`Issues`,
                                  pages: ["quality.issues"],
                                  children: issues
                                },
                                {
                                  key: "jobs",
                                  name: t`Jobs`,
                                  pages: ["production.jobs"],
                                  children: jobs.map((job) => ({
                                    ...job,
                                    methodType: "Make to Order"
                                  }))
                                },
                                {
                                  key: "jobMaterials",
                                  name: t`Job Materials`,
                                  pages: ["production.jobs"],
                                  children: jobMaterials
                                },
                                {
                                  key: "maintenanceDispatchItems",
                                  name: t`Maintenance`,
                                  pages: ["resources.dispatches"],
                                  children: maintenanceDispatchItems
                                },
                                {
                                  key: "methodMaterials",
                                  name: t`Method Materials`,
                                  pages: ITEM_PAGES,
                                  // @ts-expect-error
                                  children: methodMaterials
                                },
                                {
                                  key: "purchaseOrderLines",
                                  name: t`Purchase Orders`,
                                  pages: ["purchasing.purchaseOrders"],
                                  children: purchaseOrderLines.map((po) => ({
                                    ...po,
                                    methodType: "Purchase to Order"
                                  }))
                                },
                                {
                                  key: "receiptLines",
                                  name: t`Receipts`,
                                  pages: ["inventory.receipts"],
                                  children: receiptLines.map((receipt) => ({
                                    ...receipt,
                                    methodType: "Pull from Inventory"
                                  }))
                                },
                                {
                                  key: "quoteLines",
                                  name: t`Quotes`,
                                  pages: ["sales.quotes"],
                                  children: quoteLines
                                },
                                {
                                  key: "quoteMaterials",
                                  name: t`Quote Materials`,
                                  pages: ["sales.quotes"],
                                  children: quoteMaterials?.map((qm) => ({
                                    ...qm,
                                    documentReadableId:
                                      qm.documentReadableId ?? ""
                                  }))
                                },
                                {
                                  key: "salesOrderLines",
                                  name: t`Sales Orders`,
                                  pages: ["sales.salesOrders"],
                                  children: salesOrderLines
                                },
                                {
                                  key: "shipmentLines",
                                  name: t`Shipments`,
                                  pages: ["inventory.shipments"],
                                  children: shipmentLines.map((shipment) => ({
                                    ...shipment,
                                    methodType: "Shipment"
                                  }))
                                },
                                {
                                  key: "supplierQuotes",
                                  name: t`Supplier Quotes`,
                                  pages: ["purchasing.supplierQuotes"],
                                  children: supplierQuotes
                                }
                              ];

                              // Assembly instructions only exist for make parts
                              if (isManufactured) {
                                tree.splice(2, 0, {
                                  key: "assemblyInstructions",
                                  name: t`Assembly Instructions`,
                                  pages: ["production.assemblies"],
                                  children: assemblyInstructions
                                });
                              }

                              tree.push({
                                key: "inspections",
                                name: t`Inspections`,
                                pages: ["quality.inspections"],
                                children: inspections
                              });

                              tree.push(
                                changeNoticesUsedInNode(
                                  changeNotices,
                                  t`Change Notices`
                                )
                              );

                              return (
                                <UsedInTree
                                  tree={tree}
                                  revisions={partData.partSummary?.revisions}
                                  itemReadableId={
                                    partData.partSummary?.readableId ?? ""
                                  }
                                  itemReadableIdWithRevision={
                                    partData.partSummary
                                      ?.readableIdWithRevision ?? ""
                                  }
                                  jobMaterialUsage={jobMaterialUsage}
                                  filterText={filterText}
                                  hideSearch
                                />
                              );
                            }}
                          </Await>
                        </Suspense>
                      </TabsContent>
                    </div>
                  </Tabs>
                ) : (
                  <>
                    <HStack className="w-full justify-between flex-shrink-0 p-2 pb-0">
                      <InputGroup size="sm" className="flex flex-grow">
                        <InputLeftElement>
                          <LuSearch className="h-4 w-4" />
                        </InputLeftElement>
                        <Input
                          placeholder={t`Search...`}
                          value={filterText}
                          onChange={(e) => setFilterText(e.target.value)}
                        />
                      </InputGroup>
                    </HStack>
                    <div className="flex-1 overflow-y-auto">
                      <Suspense fallback={<UsedInSkeleton />}>
                        <Await resolve={usedIn}>
                          {(resolvedUsedIn) => {
                            const {
                              issues,
                              jobMaterials,
                              jobs,
                              maintenanceDispatchItems,
                              methodMaterials,
                              purchaseOrderLines,
                              receiptLines,
                              quoteLines,
                              quoteMaterials,
                              salesOrderLines,
                              shipmentLines,
                              supplierQuotes,
                              assemblyInstructions,
                              inspections,
                              jobMaterialUsage
                            } = resolvedUsedIn;

                            const tree: UsedInNode[] = [
                              {
                                key: "issues",
                                name: "Issues",
                                pages: ["quality.issues"],
                                children: issues
                              },
                              {
                                key: "jobs",
                                name: "Jobs",
                                pages: ["production.jobs"],
                                children: jobs.map((job) => ({
                                  ...job,
                                  methodType: "Make to Order"
                                }))
                              },
                              {
                                key: "jobMaterials",
                                name: "Job Materials",
                                pages: ["production.jobs"],
                                children: jobMaterials
                              },
                              {
                                key: "maintenanceDispatchItems",
                                name: "Maintenance",
                                pages: ["resources.dispatches"],
                                children: maintenanceDispatchItems
                              },
                              {
                                key: "methodMaterials",
                                name: "Method Materials",
                                pages: ITEM_PAGES,
                                // @ts-expect-error
                                children: methodMaterials
                              },
                              {
                                key: "purchaseOrderLines",
                                name: "Purchase Orders",
                                pages: ["purchasing.purchaseOrders"],
                                children: purchaseOrderLines.map((po) => ({
                                  ...po,
                                  methodType: "Purchase to Order"
                                }))
                              },
                              {
                                key: "receiptLines",
                                name: "Receipts",
                                pages: ["inventory.receipts"],
                                children: receiptLines.map((receipt) => ({
                                  ...receipt,
                                  methodType: "Pull from Inventory"
                                }))
                              },
                              {
                                key: "quoteLines",
                                name: "Quotes",
                                pages: ["sales.quotes"],
                                children: quoteLines
                              },
                              {
                                key: "quoteMaterials",
                                name: "Quote Materials",
                                pages: ["sales.quotes"],
                                children: quoteMaterials?.map((qm) => ({
                                  ...qm,
                                  documentReadableId:
                                    qm.documentReadableId ?? ""
                                }))
                              },
                              {
                                key: "salesOrderLines",
                                name: "Sales Orders",
                                pages: ["sales.salesOrders"],
                                children: salesOrderLines
                              },
                              {
                                key: "shipmentLines",
                                name: "Shipments",
                                pages: ["inventory.shipments"],
                                children: shipmentLines.map((shipment) => ({
                                  ...shipment,
                                  methodType: "Shipment"
                                }))
                              },
                              {
                                key: "supplierQuotes",
                                name: "Supplier Quotes",
                                pages: ["purchasing.supplierQuotes"],
                                children: supplierQuotes
                              }
                            ];

                            // Assembly instructions only exist for make parts
                            if (isManufactured) {
                              tree.splice(2, 0, {
                                key: "assemblyInstructions",
                                name: "Assembly Instructions",
                                pages: ["production.assemblies"],
                                children: assemblyInstructions
                              });
                            }

                            tree.push({
                              key: "inspections",
                              name: "Inspections",
                              pages: ["quality.inspections"],
                              children: inspections
                            });

                            tree.push(
                              changeNoticesUsedInNode(
                                changeNotices,
                                t`Change Notices`
                              )
                            );

                            return (
                              <UsedInTree
                                tree={tree}
                                revisions={partData.partSummary?.revisions}
                                itemReadableId={
                                  partData.partSummary?.readableId ?? ""
                                }
                                itemReadableIdWithRevision={
                                  partData.partSummary
                                    ?.readableIdWithRevision ?? ""
                                }
                                jobMaterialUsage={jobMaterialUsage}
                                filterText={filterText}
                                hideSearch
                              />
                            );
                          }}
                        </Await>
                      </Suspense>
                    </div>
                  </>
                )}
              </div>
            }
            content={
              <div className="bg-card h-[calc(100dvh-var(--topbar-height)-var(--header-height)-var(--content-inset))] overflow-y-auto scrollbar-hide w-full">
                <RecordOutlet />
              </div>
            }
            properties={
              <Suspense fallback={<PartProperties key={itemId} />}>
                <Await resolve={methodTree}>
                  {(resolved) => (
                    <SelectedItemProperties
                      topLevelItemId={itemId}
                      methods={resolved?.methods ?? []}
                    />
                  )}
                </Await>
              </Suspense>
            }
          />
        </div>
      </div>
    </div>
  );
}
