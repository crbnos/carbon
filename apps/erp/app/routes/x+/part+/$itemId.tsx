import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  HStack,
  Input,
  InputGroup,
  InputLeftElement,
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useRouteData
} from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Suspense, useState } from "react";
import { LuSearch } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import {
  Await,
  Outlet,
  redirect,
  useLoaderData,
  useParams
} from "react-router";
import { ResizablePanels } from "~/components/Layout";
import { flattenTree } from "~/components/TreeView";
import type { ItemFile, PartSummary } from "~/modules/items";
import {
  getItemFiles,
  getItemSupersededBy,
  getItemSupersession,
  getMakeMethodById,
  getMakeMethods,
  getMethodTree,
  getPart,
  getPartUsedIn,
  getPickMethods,
  getSupplierParts
} from "~/modules/items";
import type { Method } from "~/modules/items/types";
import {
  BoMActions,
  BoMExplorer,
  SelectedItemProperties
} from "~/modules/items/ui/Item";
import type { UsedInNode } from "~/modules/items/ui/Item/UsedIn";
import { UsedInSkeleton, UsedInTree } from "~/modules/items/ui/Item/UsedIn";
import { PartHeader, PartProperties } from "~/modules/items/ui/Parts";
import { getTagsList } from "~/modules/shared";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Parts`,
  to: path.to.parts,
  module: "items"
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
    bypassRls: true
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const [
    partSummary,
    supplierParts,
    pickMethods,
    tags,
    supersession,
    supersededBy
  ] = await Promise.all([
    getPart(client, itemId, companyId),
    getSupplierParts(client, itemId, companyId),
    getPickMethods(client, itemId, companyId),
    getTagsList(client, companyId, "part"),
    getItemSupersession(client, itemId, companyId),
    getItemSupersededBy(client, itemId, companyId)
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

  const url = new URL(request.url);
  const requestedMethodId = url.searchParams.get("methodId");

  const methodTree = getMakeMethods(client, itemId, companyId).then(
    async (makeMethods) => {
      const makeMethod = requestedMethodId
        ? (makeMethods.data?.find((m) => m.id === requestedMethodId) ??
          makeMethods.data?.find((m) => m.status === "Active") ??
          makeMethods.data?.[0])
        : (makeMethods.data?.find((m) => m.status === "Active") ??
          makeMethods.data?.[0]);
      if (!makeMethod) return null;

      const fullMethod = await getMakeMethodById(
        client,
        makeMethod.id,
        companyId
      );
      if (fullMethod.error || !fullMethod.data) return null;

      const tree = await getMethodTree(client, fullMethod.data.id);
      if (tree.error) return null;

      const methods =
        tree.data.length > 0 ? flattenTree<Method>(tree.data[0]) : [];

      return {
        makeMethod: fullMethod.data,
        methods
      };
    }
  );

  return {
    partSummary: partSummary.data,
    supersession: supersession.data,
    supersededBy: supersededBy.data ?? [],
    files: getItemFiles(client, itemId, companyId),
    supplierParts: supplierParts.data ?? [],
    pickMethods: pickMethods.data ?? [],
    makeMethods: getMakeMethods(client, itemId, companyId),
    tags: tags.data ?? [],
    usedIn: getPartUsedIn(client, itemId, companyId),
    methodTree
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

  const { usedIn, methodTree } = useLoaderData<typeof loader>();

  const isManufactured = partData.partSummary?.replenishmentSystem !== "Buy";

  const [filterText, setFilterText] = useState("");

  return (
    <div className="flex flex-col h-[calc(100dvh-49px)] overflow-hidden w-full">
      <PartHeader />
      <div className="flex h-[calc(100dvh-99px)] overflow-hidden w-full">
        <div className="flex flex-grow overflow-hidden">
          <ResizablePanels
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
                                jobMaterialUsage
                              } = resolvedUsedIn;

                              const tree: UsedInNode[] = [
                                {
                                  key: "issues",
                                  name: t`Issues`,
                                  module: "quality",
                                  children: issues
                                },
                                {
                                  key: "jobs",
                                  name: t`Jobs`,
                                  module: "production",
                                  children: jobs.map((job) => ({
                                    ...job,
                                    methodType: "Make to Order"
                                  }))
                                },
                                {
                                  key: "jobMaterials",
                                  name: t`Job Materials`,
                                  module: "production",
                                  children: jobMaterials
                                },
                                {
                                  key: "maintenanceDispatchItems",
                                  name: t`Maintenance`,
                                  module: "resources",
                                  children: maintenanceDispatchItems
                                },
                                {
                                  key: "methodMaterials",
                                  name: t`Method Materials`,
                                  module: "parts",
                                  // @ts-expect-error
                                  children: methodMaterials
                                },
                                {
                                  key: "purchaseOrderLines",
                                  name: t`Purchase Orders`,
                                  module: "purchasing",
                                  children: purchaseOrderLines.map((po) => ({
                                    ...po,
                                    methodType: "Purchase to Order"
                                  }))
                                },
                                {
                                  key: "receiptLines",
                                  name: t`Receipts`,
                                  module: "inventory",
                                  children: receiptLines.map((receipt) => ({
                                    ...receipt,
                                    methodType: "Pull from Inventory"
                                  }))
                                },
                                {
                                  key: "quoteLines",
                                  name: t`Quotes`,
                                  module: "sales",
                                  children: quoteLines
                                },
                                {
                                  key: "quoteMaterials",
                                  name: t`Quote Materials`,
                                  module: "sales",
                                  children: quoteMaterials?.map((qm) => ({
                                    ...qm,
                                    documentReadableId:
                                      qm.documentReadableId ?? ""
                                  }))
                                },
                                {
                                  key: "salesOrderLines",
                                  name: t`Sales Orders`,
                                  module: "sales",
                                  children: salesOrderLines
                                },
                                {
                                  key: "shipmentLines",
                                  name: t`Shipments`,
                                  module: "inventory",
                                  children: shipmentLines.map((shipment) => ({
                                    ...shipment,
                                    methodType: "Shipment"
                                  }))
                                },
                                {
                                  key: "supplierQuotes",
                                  name: t`Supplier Quotes`,
                                  module: "purchasing",
                                  children: supplierQuotes
                                }
                              ];

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
                              jobMaterialUsage
                            } = resolvedUsedIn;

                            const tree: UsedInNode[] = [
                              {
                                key: "issues",
                                name: "Issues",
                                module: "quality",
                                children: issues
                              },
                              {
                                key: "jobs",
                                name: "Jobs",
                                module: "production",
                                children: jobs.map((job) => ({
                                  ...job,
                                  methodType: "Make to Order"
                                }))
                              },
                              {
                                key: "jobMaterials",
                                name: "Job Materials",
                                module: "production",
                                children: jobMaterials
                              },
                              {
                                key: "maintenanceDispatchItems",
                                name: "Maintenance",
                                module: "resources",
                                children: maintenanceDispatchItems
                              },
                              {
                                key: "methodMaterials",
                                name: "Method Materials",
                                module: "parts",
                                // @ts-expect-error
                                children: methodMaterials
                              },
                              {
                                key: "purchaseOrderLines",
                                name: "Purchase Orders",
                                module: "purchasing",
                                children: purchaseOrderLines.map((po) => ({
                                  ...po,
                                  methodType: "Purchase to Order"
                                }))
                              },
                              {
                                key: "receiptLines",
                                name: "Receipts",
                                module: "inventory",
                                children: receiptLines.map((receipt) => ({
                                  ...receipt,
                                  methodType: "Pull from Inventory"
                                }))
                              },
                              {
                                key: "quoteLines",
                                name: "Quotes",
                                module: "sales",
                                children: quoteLines
                              },
                              {
                                key: "quoteMaterials",
                                name: "Quote Materials",
                                module: "sales",
                                children: quoteMaterials?.map((qm) => ({
                                  ...qm,
                                  documentReadableId:
                                    qm.documentReadableId ?? ""
                                }))
                              },
                              {
                                key: "salesOrderLines",
                                name: "Sales Orders",
                                module: "sales",
                                children: salesOrderLines
                              },
                              {
                                key: "shipmentLines",
                                name: "Shipments",
                                module: "inventory",
                                children: shipmentLines.map((shipment) => ({
                                  ...shipment,
                                  methodType: "Shipment"
                                }))
                              },
                              {
                                key: "supplierQuotes",
                                name: "Supplier Quotes",
                                module: "purchasing",
                                children: supplierQuotes
                              }
                            ];

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
              <div className="h-[calc(100dvh-99px)] overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent w-full">
                <Outlet />
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
