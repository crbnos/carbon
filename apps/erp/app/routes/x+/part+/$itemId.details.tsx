import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import {
  ClientOnly,
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
import { CadModel } from "~/components";
import { usePermissions, useRouteData } from "~/hooks";
import type { ItemFile, PartSummary } from "~/modules/items";
import { getPartUsedIn, partValidator, upsertPart } from "~/modules/items";
import { ItemDocuments, ItemNotes } from "~/modules/items/ui/Item";

import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";
import {
  UsedInSkeleton,
  UsedInItem,
  UsedInTree,
} from "~/modules/items/ui/Item/UsedIn";

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
  const validation = await validator(partValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const updatePart = await upsertPart(client, {
    ...validation.data,
    id: itemId,
    customFields: setCustomFields(formData),
    updatedBy: userId,
  });
  if (updatePart.error) {
    throw redirect(
      path.to.part(itemId),
      await flash(request, error(updatePart.error, "Failed to update part"))
    );
  }

  throw redirect(
    path.to.part(itemId),
    await flash(request, success("Updated part"))
  );
}

export default function PartDetailsRoute() {
  const { usedIn } = useLoaderData<typeof loader>();

  const { itemId } = useParams();
  if (!itemId) throw new Error("Could not find itemId");

  const partData = useRouteData<{
    partSummary: PartSummary;
    files: Promise<ItemFile[]>;
  }>(path.to.part(itemId));

  if (!partData) throw new Error("Could not find part data");
  const permissions = usePermissions();

  return (
    <div className="flex flex-grow overflow-hidden">
      <ClientOnly fallback={null}>
        {() => (
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
                          quoteLines,
                          quoteMaterials,
                          salesOrderLines,
                        } = resolvedUsedIn;

                        const tree: UsedInItem[] = [
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
                            key: "quoteLines",
                            name: "Quotes",
                            module: "sales",
                            children: quoteLines,
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
                        ];

                        return (
                          <UsedInTree
                            tree={tree}
                            itemReadableId={partData.partSummary?.id ?? ""}
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
                    id={partData.partSummary?.itemId ?? null}
                    title={partData.partSummary?.name ?? ""}
                    subTitle={partData.partSummary?.id ?? ""}
                    notes={partData.partSummary?.notes as JSONContent}
                  />
                  {permissions.is("employee") && (
                    <>
                      <Suspense
                        fallback={
                          <div className="flex w-full h-full rounded bg-gradient-to-tr from-background to-card items-center justify-center">
                            <Spinner className="h-10 w-10" />
                          </div>
                        }
                      >
                        <Await resolve={partData?.files}>
                          {(resolvedFiles) => (
                            <ItemDocuments
                              files={resolvedFiles}
                              itemId={itemId}
                              modelUpload={partData.partSummary ?? undefined}
                              type="Part"
                            />
                          )}
                        </Await>
                      </Suspense>

                      <CadModel
                        isReadOnly={!permissions.can("update", "parts")}
                        metadata={{ itemId }}
                        modelPath={partData?.partSummary?.modelPath ?? null}
                        title="CAD Model"
                      />
                    </>
                  )}
                </VStack>
              </ScrollArea>
            </ResizablePanel>
          </ResizablePanelGroup>
        )}
      </ClientOnly>
    </div>
  );
}
