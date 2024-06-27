import type { JSONContent } from "@carbon/react";
import {
  Button,
  ClientOnly,
  HStack,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  ScrollArea,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  VStack,
} from "@carbon/react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import {
  Outlet,
  json,
  redirect,
  useLoaderData,
  useParams,
} from "@remix-run/react";
import { LuCopy, LuLink } from "react-icons/lu";

import type { FlatTreeItem } from "~/components/TreeView/TreeView";
import { flattenTree } from "~/components/TreeView/TreeView";
import { useRouteData } from "~/hooks";
import type {
  Method,
  MethodItemType,
  MethodType,
  PartSummary,
} from "~/modules/items";
import {
  BoMExplorer,
  getMakeMethod,
  getMethodMaterials,
  getMethodOperations,
  getMethodTree,
} from "~/modules/items";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const makeMethod = await getMakeMethod(client, itemId, companyId);

  if (makeMethod.error) {
    throw redirect(
      path.to.partDetails(itemId),
      await flash(
        request,
        error(makeMethod.error, "Failed to load make method")
      )
    );
  }

  const [methodTree, methodMaterials, methodOperations] = await Promise.all([
    getMethodTree(client, makeMethod.data.id),
    getMethodMaterials(client, makeMethod.data.id),
    getMethodOperations(client, makeMethod.data.id),
  ]);
  if (methodTree?.error) {
    throw redirect(
      path.to.partDetails(itemId),
      await flash(
        request,
        error(methodTree.error, "Failed to load method tree")
      )
    );
  }

  if (methodOperations.error) {
    throw redirect(
      path.to.partDetails(itemId),
      await flash(
        request,
        error(methodOperations.error, "Failed to load method operations")
      )
    );
  }
  if (methodMaterials.error) {
    throw redirect(
      path.to.partDetails(itemId),
      await flash(
        request,
        error(methodMaterials.error, "Failed to load method materials")
      )
    );
  }

  return json({
    makeMethod: makeMethod.data,
    methodMaterials:
      methodMaterials.data?.map((m) => ({
        ...m,
        description: m.item?.name ?? "",
        methodType: m.methodType as MethodType,
        itemType: m.itemType as MethodItemType,
      })) ?? [],
    methodOperations:
      methodOperations.data?.map((operation) => ({
        ...operation,
        equipmentTypeId: operation.equipmentTypeId ?? undefined,
        methodOperationWorkInstruction:
          operation.methodOperationWorkInstruction as {
            content: JSONContent | null;
          },
      })) ?? [],
    methods: (methodTree.data.length > 0
      ? flattenTree(methodTree.data[0])
      : []) satisfies FlatTreeItem<Method>[],
  });
}

export default function PartManufacturing() {
  const { methods } = useLoaderData<typeof loader>();

  const params = useParams();
  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const routeData = useRouteData<{
    partSummary: PartSummary;
  }>(path.to.part(itemId));

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
              <ScrollArea className="h-[calc(100vh-99px)]">
                <div className="grid h-full overflow-hidden p-2">
                  <BoMExplorer
                    // @ts-ignore
                    methods={methods}
                  />
                </div>
              </ScrollArea>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel
              order={2}
              minSize={40}
              defaultSize={60}
              className="border-t border-border"
            >
              <ScrollArea className="h-[calc(100vh-99px)]">
                <Outlet key={JSON.stringify(params)} />
              </ScrollArea>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel
              order={3}
              minSize={10}
              defaultSize={20}
              className="bg-card"
            >
              <ScrollArea className="h-[calc(100vh-99px)] px-4 py-2">
                <VStack spacing={2}>
                  <HStack className="w-full justify-between">
                    <h3 className="text-xs text-muted-foreground">
                      Properties
                    </h3>
                    <HStack spacing={1}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            aria-label="Link"
                            size="sm"
                            className="p-1"
                            onClick={() =>
                              navigator.clipboard.writeText(
                                window.location.origin + path.to.part(itemId)
                              )
                            }
                          >
                            <LuLink className="w-3 h-3" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <span>Copy link to part</span>
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            aria-label="Copy"
                            size="sm"
                            className="p-1"
                            onClick={() =>
                              navigator.clipboard.writeText(
                                routeData?.partSummary?.id ?? ""
                              )
                            }
                          >
                            <LuCopy className="w-3 h-3" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <span>Copy part number</span>
                        </TooltipContent>
                      </Tooltip>
                    </HStack>
                  </HStack>
                  <span className="text-sm">
                    {routeData?.partSummary?.name}
                  </span>
                </VStack>
              </ScrollArea>
            </ResizablePanel>
          </ResizablePanelGroup>
        )}
      </ClientOnly>
    </div>
  );
}
