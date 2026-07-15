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
import type { ItemFile, ServiceSummary } from "~/modules/items";
import {
  getItemFiles,
  getItemSupersededBy,
  getItemSupersession,
  getMakeMethodById,
  getMakeMethods,
  getMethodTree,
  getPartUsedIn,
  getService,
  getSupplierParts
} from "~/modules/items";
import { BoMActions, BoMExplorer } from "~/modules/items/ui/Item";
import type { UsedInNode } from "~/modules/items/ui/Item/UsedIn";
import { UsedInSkeleton, UsedInTree } from "~/modules/items/ui/Item/UsedIn";
import { ServiceHeader, ServiceProperties } from "~/modules/items/ui/Services";
import { getTagsList } from "~/modules/shared";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Services`,
  to: path.to.services,
  module: "items"
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
    bypassRls: true
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const [serviceSummary, supplierParts, tags, supersession, supersededBy] =
    await Promise.all([
      getService(client, itemId, companyId),
      getSupplierParts(client, itemId, companyId),
      getTagsList(client, companyId, "service"),
      getItemSupersession(client, itemId, companyId),
      getItemSupersededBy(client, itemId, companyId)
    ]);

  if (serviceSummary.error) {
    throw redirect(
      path.to.items,
      await flash(
        request,
        error(serviceSummary.error, "Failed to load service summary")
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

      const methods = tree.data.length > 0 ? flattenTree(tree.data[0]) : [];

      return {
        makeMethod: fullMethod.data,
        methods
      };
    }
  );

  return {
    serviceSummary: serviceSummary.data,
    supersession: supersession.data,
    supersededBy: supersededBy.data ?? [],
    files: getItemFiles(client, itemId, companyId),
    supplierParts: supplierParts.data ?? [],
    makeMethods: getMakeMethods(client, itemId, companyId),
    tags: tags.data ?? [],
    usedIn: getPartUsedIn(client, itemId, companyId),
    methodTree
  };
}

export default function ServiceRoute() {
  const { t } = useLingui();
  const { itemId } = useParams();
  if (!itemId) throw new Error("Could not find itemId");

  const serviceData = useRouteData<{
    serviceSummary: ServiceSummary;
    files: Promise<ItemFile[]>;
  }>(path.to.service(itemId));

  if (!serviceData) throw new Error("Could not find service data");

  const { usedIn, methodTree } = useLoaderData<typeof loader>();

  const isManufactured =
    serviceData.serviceSummary?.replenishmentSystem !== "Buy";

  const [filterText, setFilterText] = useState("");

  const renderUsedInTree = (resolvedUsedIn: Awaited<typeof usedIn>) => {
    const {
      issues,
      jobs,
      purchaseOrderLines,
      quoteLines,
      salesOrderLines,
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
        key: "purchaseOrderLines",
        name: t`Purchase Orders`,
        module: "purchasing",
        children: purchaseOrderLines.map((po) => ({
          ...po,
          methodType: "Purchase to Order"
        }))
      },
      {
        key: "quoteLines",
        name: t`Quotes`,
        module: "sales",
        children: quoteLines
      },
      {
        key: "salesOrderLines",
        name: t`Sales Orders`,
        module: "sales",
        children: salesOrderLines
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
        revisions={serviceData.serviceSummary?.revisions}
        itemReadableId={serviceData.serviceSummary?.readableId ?? ""}
        itemReadableIdWithRevision={
          serviceData.serviceSummary?.readableIdWithRevision ?? ""
        }
        jobMaterialUsage={jobMaterialUsage}
        filterText={filterText}
        hideSearch
      />
    );
  };

  return (
    <div className="flex flex-col h-[calc(100dvh-49px)] overflow-hidden w-full">
      <ServiceHeader />
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
                                    itemType="Service"
                                    makeMethod={resolved.makeMethod}
                                    // @ts-ignore
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
                          <Await resolve={usedIn}>{renderUsedInTree}</Await>
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
                        <Await resolve={usedIn}>{renderUsedInTree}</Await>
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
            properties={<ServiceProperties key={itemId} />}
          />
        </div>
      </div>
    </div>
  );
}
