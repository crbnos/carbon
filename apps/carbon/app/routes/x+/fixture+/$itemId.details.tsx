import { validationError, validator } from "@carbon/form";
import { VStack } from "@carbon/react";
import { useParams } from "@remix-run/react";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { CadModel } from "~/components";
import { usePermissions, useRouteData } from "~/hooks";
import type { Fixture, ItemFile } from "~/modules/items";
import {
  FixtureForm,
  ItemDocuments,
  fixtureValidator,
  upsertFixture,
} from "~/modules/items";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error, success } from "~/utils/result";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "parts",
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const formData = await request.formData();
  const validation = await validator(fixtureValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const updateFixture = await upsertFixture(client, {
    ...validation.data,
    id: itemId,
    customFields: setCustomFields(formData),
    updatedBy: userId,
  });
  if (updateFixture.error) {
    throw redirect(
      path.to.fixture(itemId),
      await flash(
        request,
        error(updateFixture.error, "Failed to update fixture")
      )
    );
  }

  throw redirect(
    path.to.fixture(itemId),
    await flash(request, success("Updated fixture"))
  );
}

export default function FixtureDetailsRoute() {
  const permissions = usePermissions();

  const { itemId } = useParams();
  if (!itemId) throw new Error("Could not find itemId");

  const fixtureData = useRouteData<{
    fixtureSummary: Fixture;
    files: ItemFile[];
  }>(path.to.fixture(itemId));
  if (!fixtureData) throw new Error("Could not find fixture data");

  const fixtureInitialValues = {
    id: fixtureData.fixtureSummary?.id ?? "",
    itemId: fixtureData.fixtureSummary?.itemId ?? "",
    name: fixtureData.fixtureSummary?.name ?? "",
    description: fixtureData.fixtureSummary?.description ?? "",
    replenishmentSystem:
      fixtureData.fixtureSummary?.replenishmentSystem ?? "Buy",
    defaultMethodType: fixtureData.fixtureSummary?.defaultMethodType ?? "Buy",
    itemTrackingType:
      fixtureData.fixtureSummary?.itemTrackingType ?? "Inventory",
    active: fixtureData.fixtureSummary?.active ?? true,
    customerId: fixtureData.fixtureSummary?.customerId ?? "",
    unitOfMeasureCode: "EA",
    ...getCustomFields(fixtureData.fixtureSummary?.customFields ?? {}),
  };

  return (
    <VStack spacing={2} className="p-2">
      <FixtureForm
        key={fixtureInitialValues.id}
        initialValues={fixtureInitialValues}
      />
      {permissions.is("employee") && (
        <div className="grid grid-cols-1 md:grid-cols-2 w-full flex-grow gap-2">
          <CadModel
            autodeskUrn={fixtureData?.fixtureSummary?.autodeskUrn ?? null}
            isReadOnly={!permissions.can("update", "parts")}
            metadata={{
              itemId,
            }}
            modelPath={fixtureData?.fixtureSummary?.modelPath ?? null}
            title="CAD Model"
          />
          <ItemDocuments
            files={fixtureData?.files ?? []}
            itemId={itemId}
            modelUpload={fixtureData.fixtureSummary}
            type="Fixture"
          />
        </div>
      )}
    </VStack>
  );
}
