import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import { VStack } from "@carbon/react";
import type { ActionFunctionArgs } from "react-router";
import { redirect, useParams } from "react-router";
import { DeferredFiles } from "~/components";
import { usePermissions, useRouteData } from "~/hooks";
import type { ItemFile, MaterialSummary } from "~/modules/items";
import {
  materialValidator,
  upsertItemStockDimension,
  upsertMaterial
} from "~/modules/items";
import {
  ItemDocuments,
  ItemNotes,
  ItemRiskRegister
} from "~/modules/items/ui/Item";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const formData = await request.formData();
  const validation = await validator(materialValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const {
    stockLength,
    stockWidth,
    stockThickness,
    unitOfDimension,
    ...materialData
  } = validation.data;

  const updateMaterial = await upsertMaterial(client, {
    ...materialData,
    id: itemId,
    customFields: setCustomFields(formData),
    updatedBy: userId
  });
  if (updateMaterial.error) {
    throw redirect(
      path.to.material(itemId),
      await flash(
        request,
        error(updateMaterial.error, "Failed to update material")
      )
    );
  }

  if (stockLength || stockWidth || stockThickness) {
    await upsertItemStockDimension(client, {
      itemId,
      companyId,
      stockLength: stockLength ?? null,
      stockWidth: stockWidth ?? null,
      stockThickness: stockThickness ?? null,
      unitOfDimension: unitOfDimension || "in",
      createdBy: userId,
      updatedBy: userId
    });
  }

  throw redirect(
    path.to.material(itemId),
    await flash(request, success("Updated material"))
  );
}

export default function MaterialDetailsRoute() {
  const { itemId } = useParams();
  if (!itemId) throw new Error("Could not find itemId");

  const materialData = useRouteData<{
    materialSummary: MaterialSummary;
    files: Promise<ItemFile[]>;
  }>(path.to.material(itemId));

  if (!materialData) throw new Error("Could not find material data");
  const permissions = usePermissions();

  return (
    <VStack spacing={2} className="p-2">
      <ItemNotes
        id={materialData.materialSummary?.id ?? null}
        title={materialData.materialSummary?.name ?? ""}
        subTitle={materialData.materialSummary?.readableIdWithRevision ?? ""}
        notes={materialData.materialSummary?.notes as JSONContent}
      />
      {permissions.is("employee") && (
        <>
          <DeferredFiles resolve={materialData?.files}>
            {(resolvedFiles) => (
              <ItemDocuments
                files={resolvedFiles}
                itemId={itemId}
                type="Material"
              />
            )}
          </DeferredFiles>

          <ItemRiskRegister itemId={itemId} />
        </>
      )}
    </VStack>
  );
}
