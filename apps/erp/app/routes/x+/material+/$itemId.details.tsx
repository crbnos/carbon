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
import { usePermissions, useRouteData } from "~/hooks";
import type { ItemFile, Material } from "~/modules/items";
import { materialValidator, upsertMaterial } from "~/modules/items";
import { ItemDocuments, ItemNotes } from "~/modules/items/ui/Item";

import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "parts",
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const formData = await request.formData();
  const validation = await validator(materialValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const updateMaterial = await upsertMaterial(client, {
    ...validation.data,
    id: itemId,
    customFields: setCustomFields(formData),
    updatedBy: userId,
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

  throw redirect(
    path.to.material(itemId),
    await flash(request, success("Updated material"))
  );
}

export default function MaterialDetailsRoute() {
  const permissions = usePermissions();

  const { itemId } = useParams();
  if (!itemId) throw new Error("Could not find itemId");

  const materialData = useRouteData<{
    materialSummary: Material;
    files: Promise<ItemFile[]>;
  }>(path.to.material(itemId));
  if (!materialData) throw new Error("Could not find material data");

  return (
    <VStack spacing={2} className="w-full h-full p-2">
      <ItemNotes
        id={materialData.materialSummary?.itemId ?? null}
        title={materialData.materialSummary?.id ?? ""}
        subTitle={materialData.materialSummary?.name ?? ""}
        notes={materialData.materialSummary?.notes as JSONContent}
      />
      {permissions.is("employee") && (
        <Suspense
          fallback={
            <div className="flex w-full h-full rounded bg-gradient-to-tr from-background to-card items-center justify-center">
              <Spinner className="h-10 w-10" />
            </div>
          }
        >
          <Await resolve={materialData?.files}>
            {(files) => (
              <ItemDocuments
                files={files ?? []}
                itemId={itemId}
                type="Material"
              />
            )}
          </Await>
        </Suspense>
      )}
    </VStack>
  );
}
