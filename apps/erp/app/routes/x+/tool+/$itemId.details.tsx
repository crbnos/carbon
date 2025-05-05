import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  ScrollArea,
  Spinner,
  VStack,
} from "@carbon/react";
import { Await, useLoaderData, useParams } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { defer, redirect } from "@vercel/remix";
import { Suspense } from "react";
import { usePermissions, useRouteData } from "~/hooks";
import type { ItemFile, ToolSummary } from "~/modules/items";
import { getPartUsedIn, toolValidator, upsertTool } from "~/modules/items";
import { ItemDocuments, ItemNotes } from "~/modules/items/ui/Item";
import type { UsedInNode } from "~/modules/items/ui/Item/UsedIn";
import { UsedInSkeleton, UsedInTree } from "~/modules/items/ui/Item/UsedIn";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
    bypassRls: true,
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  return defer({ usedIn: getPartUsedIn(client, itemId, companyId) });
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "parts",
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const formData = await request.formData();
  const validation = await validator(toolValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const updateTool = await upsertTool(client, {
    ...validation.data,
    id: itemId,
    customFields: setCustomFields(formData),
    updatedBy: userId,
  });
  if (updateTool.error) {
    throw redirect(
      path.to.tool(itemId),
      await flash(request, error(updateTool.error, "Failed to update tool"))
    );
  }

  throw redirect(
    path.to.tool(itemId),
    await flash(request, success("Updated tool"))
  );
}

export default function ToolDetailsRoute() {
  const { usedIn } = useLoaderData<typeof loader>();

  const { itemId } = useParams();
  if (!itemId) throw new Error("Could not find itemId");

  const toolData = useRouteData<{
    toolSummary: ToolSummary;
    files: Promise<ItemFile[]>;
  }>(path.to.tool(itemId));
  if (!toolData) throw new Error("Could not find tool data");
  const permissions = usePermissions();

  return (
    <div className="flex flex-grow overflow-hidden">
      <ResizablePanelGroup direction="horizontal">
        <ResizablePanel
          order={1}
          minSize={10}
          defaultSize={20}
          className="bg-card"
        >
          <ScrollArea className="h-[calc(100dvh-99px)]">
            <div className="grid h-full overflow-hidden p-2">
              <Suspense fallback={<UsedInSkeleton />}>
                <Await resolve={usedIn}>
                  {(resolvedUsedIn) => {
                    const {
                      jobMaterials,
                      jobs,
                      methodMaterials,
                      purchaseOrderLines,
                      receiptLines,
                      quoteMaterials,
                      salesOrderLines,
                      shipmentLines,
                      supplierQuotes,
                    } = resolvedUsedIn;

                    const tree: UsedInNode[] = [
                      {
                        key: "jobs",
                        name: "Jobs",
                        module: "production",
                        children: jobs.map((job) => ({
                          ...job,
                          methodType: "Make",
                        })),
                      },
                      {
                        key: "jobMaterials",
                        name: "Job Materials",
                        module: "production",
                        children: jobMaterials,
                      },
                      {
                        key: "methodMaterials",
                        name: "Method Materials",
                        module: "parts",
                        // @ts-expect-error
                        children: methodMaterials,
                      },
                      {
                        key: "purchaseOrderLines",
                        name: "Purchase Orders",
                        module: "purchasing",
                        children: purchaseOrderLines.map((po) => ({
                          ...po,
                          methodType: "Buy",
                        })),
                      },
                      {
                        key: "receiptLines",
                        name: "Receipts",
                        module: "inventory",
                        children: receiptLines.map((receipt) => ({
                          ...receipt,
                          methodType: "Pick",
                        })),
                      },
                      {
                        key: "quoteMaterials",
                        name: "Quote Materials",
                        module: "sales",
                        children: quoteMaterials?.map((qm) => ({
                          ...qm,
                          documentReadableId: qm.documentReadableId ?? "",
                        })),
                      },
                      {
                        key: "salesOrderLines",
                        name: "Sales Orders",
                        module: "sales",
                        children: salesOrderLines,
                      },
                      {
                        key: "shipmentLines",
                        name: "Shipments",
                        module: "inventory",
                        children: shipmentLines.map((shipment) => ({
                          ...shipment,
                          methodType: "Shipment",
                        })),
                      },
                      {
                        key: "supplierQuotes",
                        name: "Supplier Quotes",
                        module: "purchasing",
                        children: supplierQuotes,
                      },
                    ];

                    return (
                      <UsedInTree
                        tree={tree}
                        itemReadableId={toolData.toolSummary?.id ?? ""}
                      />
                    );
                  }}
                </Await>
              </Suspense>
            </div>
          </ScrollArea>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel order={2} minSize={40} defaultSize={60}>
          <ScrollArea className="h-[calc(100dvh-99px)]">
            <VStack spacing={2} className="p-2">
              <ItemNotes
                id={toolData.toolSummary?.itemId ?? null}
                title={toolData.toolSummary?.id ?? ""}
                subTitle={toolData.toolSummary?.name ?? ""}
                notes={toolData.toolSummary?.notes as JSONContent}
              />
              {permissions.is("employee") && (
                <Suspense
                  fallback={
                    <div className="flex w-full h-full rounded bg-gradient-to-tr from-background to-card items-center justify-center">
                      <Spinner className="h-10 w-10" />
                    </div>
                  }
                >
                  <Await resolve={toolData?.files}>
                    {(files) => (
                      <ItemDocuments
                        files={files ?? []}
                        itemId={itemId}
                        type="Tool"
                      />
                    )}
                  </Await>
                </Suspense>
              )}
            </VStack>
          </ScrollArea>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
