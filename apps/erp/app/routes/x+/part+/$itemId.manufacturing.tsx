import type { JSONContent } from "@carbon/react";
import {
  ClientOnly,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  ScrollArea,
} from "@carbon/react";
import type { ShouldRevalidateFunctionArgs } from "@remix-run/react";
import {
  Outlet,
  json,
  redirect,
  useLoaderData,
  useParams,
} from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";

import { error, getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { FlatTreeItem } from "~/components/TreeView";
import { flattenTree } from "~/components/TreeView";
import type { Method } from "~/modules/items";
import {
  getConfigurationParameters,
  getConfigurationRules,
  getItemManufacturing,
  getMakeMethod,
  getMethodMaterialsByMakeMethod,
  getMethodOperationsByMakeMethodId,
  getMethodTree,
} from "~/modules/items";
import { BoMExplorer } from "~/modules/items/ui/Item";
import type { MethodItemType, MethodType } from "~/modules/shared";
import { path } from "~/utils/path";

export const shouldRevalidate = ({
  formAction,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) => {
  // Replace '/specific/path' with the path you want to exclude
  if (formAction && formAction.includes("tool")) {
    return false;
  }
  return defaultShouldRevalidate;
};

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

  if (companyId !== makeMethod.data.companyId) {
    throw redirect(
      path.to.authenticatedRoot,
      await flash(request, error("Access denied"))
    );
  }
  const serviceRole = await getCarbonServiceRole();

  const [methodTree, methodMaterials, methodOperations, partManufacturing] =
    await Promise.all([
      getMethodTree(serviceRole, makeMethod.data.id),
      getMethodMaterialsByMakeMethod(serviceRole, makeMethod.data.id),
      getMethodOperationsByMakeMethodId(serviceRole, makeMethod.data.id),
      getItemManufacturing(serviceRole, itemId, companyId),
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
        workCenterId: operation.workCenterId ?? undefined,
        operationSupplierProcessId:
          operation.operationSupplierProcessId ?? undefined,
        workInstruction: operation.workInstruction as JSONContent | null,
      })) ?? [],
    methods: (methodTree.data.length > 0
      ? flattenTree(methodTree.data[0])
      : []) satisfies FlatTreeItem<Method>[],
    partManufacturing: partManufacturing.data,
    configurationParametersAndGroups: partManufacturing.data
      ?.requiresConfiguration
      ? await getConfigurationParameters(serviceRole, itemId, companyId)
      : { groups: [], parameters: [] },
    configurationRules: partManufacturing.data?.requiresConfiguration
      ? await getConfigurationRules(serviceRole, itemId, companyId)
      : [],
  });
}

export default function PartManufacturing() {
  const { methods } = useLoaderData<typeof loader>();

  const params = useParams();
  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

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
                  <BoMExplorer
                    itemType="Part"
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
              <ScrollArea className="h-[calc(100dvh-99px)]">
                <Outlet key={JSON.stringify(params)} />
              </ScrollArea>
            </ResizablePanel>
          </ResizablePanelGroup>
        )}
      </ClientOnly>
    </div>
  );
}
