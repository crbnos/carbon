import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import { Spinner, VStack } from "@carbon/react";
import { Await, useParams } from "@remix-run/react";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { Suspense } from "react";
import { CadModel } from "~/components";
import { usePermissions, useRouteData } from "~/hooks";
import type { ItemFile, PartSummary } from "~/modules/items";
import { partValidator, upsertPart } from "~/modules/items";
import { ItemDocuments, ItemNotes } from "~/modules/items/ui/Item";
import { PartForm } from "~/modules/items/ui/Parts";

import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

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
  const { itemId } = useParams();
  if (!itemId) throw new Error("Could not find itemId");

  const partData = useRouteData<{
    partSummary: PartSummary;
    files: Promise<ItemFile[]>;
  }>(path.to.part(itemId));

  if (!partData) throw new Error("Could not find part data");
  const permissions = usePermissions();

  const partInitialValues = {
    id: partData.partSummary?.id ?? "",
    itemId: partData.partSummary?.itemId ?? "",
    name: partData.partSummary?.name ?? "",
    description: partData.partSummary?.description ?? "",
    replenishmentSystem: partData.partSummary?.replenishmentSystem ?? "Buy",
    defaultMethodType: partData.partSummary?.defaultMethodType ?? "Buy",
    itemTrackingType: partData.partSummary?.itemTrackingType ?? "Inventory",
    active: partData.partSummary?.active ?? true,
    unitOfMeasureCode: partData.partSummary?.unitOfMeasureCode ?? "EA",
    tags: partData.partSummary?.tags ?? [],
    ...getCustomFields(partData.partSummary?.customFields ?? {}),
  };

  return (
    <VStack spacing={2} className="p-2">
      <PartForm
        key={JSON.stringify(partInitialValues)}
        initialValues={partInitialValues}
      />
      <ItemNotes
        id={partData.partSummary?.itemId ?? null}
        title={partData.partSummary?.id ?? ""}
        subTitle={partData.partSummary?.name ?? ""}
        notes={partData.partSummary?.notes as JSONContent}
      />
      {permissions.is("employee") && (
        <div className="grid grid-cols-1 2xl:grid-cols-2 w-full flex-grow gap-2">
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
        </div>
      )}
    </VStack>
  );
}
