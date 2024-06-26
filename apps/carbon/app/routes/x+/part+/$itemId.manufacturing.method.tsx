import {
  Button,
  HStack,
  ResizableHandle,
  ResizablePanel,
  ScrollArea,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  VStack,
} from "@carbon/react";
import { validationError, validator } from "@carbon/remix-validated-form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, useLoaderData, useParams } from "@remix-run/react";
import { LuCopy, LuLink } from "react-icons/lu";
import { redirect } from "remix-typedjson";
import { useRouteData } from "~/hooks";

import type {
  MakeMethod,
  Material,
  MethodOperation,
  PartSummary,
} from "~/modules/items";
import {
  BillOfMaterial,
  BillOfProcess,
  PartManufacturingForm,
  getItemManufacturing,
  partManufacturingValidator,
  upsertItemManufacturing,
} from "~/modules/items";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error, success } from "~/utils/result";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const [partManufacturing] = await Promise.all([
    getItemManufacturing(client, itemId, companyId),
  ]);

  if (partManufacturing.error) {
    throw redirect(
      path.to.partDetails(itemId),
      await flash(
        request,
        error(partManufacturing.error, "Failed to load part manufacturing")
      )
    );
  }

  return json({
    partManufacturing: partManufacturing.data,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "parts",
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const formData = await request.formData();
  const validation = await validator(partManufacturingValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const updatePartManufacturing = await upsertItemManufacturing(client, {
    ...validation.data,
    itemId,
    updatedBy: userId,
    customFields: setCustomFields(formData),
  });
  if (updatePartManufacturing.error) {
    throw redirect(
      path.to.part(itemId),
      await flash(
        request,
        error(
          updatePartManufacturing.error,
          "Failed to update part manufacturing"
        )
      )
    );
  }

  throw redirect(
    path.to.partManufacturing(itemId),
    await flash(request, success("Updated part manufacturing"))
  );
}

export default function MakeMethodRoute() {
  const { partManufacturing } = useLoaderData<typeof loader>();
  const { itemId } = useParams();
  if (!itemId) throw new Error("Could not find itemId");

  const manufacturingRouteData = useRouteData<{
    makeMethod: MakeMethod;
    methodMaterials: Material[];
    methodOperations: MethodOperation[];
  }>(path.to.partManufacturing(itemId));

  const makeMethodId = manufacturingRouteData?.makeMethod?.id;
  if (!makeMethodId) throw new Error("Could not find makeMethodId");

  const manufacturingInitialValues = {
    ...partManufacturing,
    lotSize: partManufacturing.lotSize ?? 0,
    ...getCustomFields(partManufacturing.customFields),
  };

  const routeData = useRouteData<{
    partSummary: PartSummary;
  }>(path.to.part(itemId));

  return (
    <>
      <ResizablePanel
        order={2}
        minSize={40}
        defaultSize={60}
        className="border-t border-border"
      >
        <ScrollArea className="h-[calc(100vh-99px)]">
          <VStack spacing={2} className="p-2">
            <PartManufacturingForm
              key={itemId}
              initialValues={manufacturingInitialValues}
            />
            <BillOfMaterial
              key={itemId}
              makeMethodId={makeMethodId}
              // @ts-ignore
              materials={manufacturingRouteData?.methodMaterials ?? []}
            />
            <BillOfProcess
              key={itemId}
              makeMethodId={makeMethodId}
              // @ts-ignore
              operations={manufacturingRouteData?.methodOperations ?? []}
            />
          </VStack>
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
              <h3 className="text-xs text-muted-foreground">Properties</h3>
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
            <span className="text-sm">{routeData?.partSummary?.name}</span>
          </VStack>
        </ScrollArea>
      </ResizablePanel>
    </>
  );
}
