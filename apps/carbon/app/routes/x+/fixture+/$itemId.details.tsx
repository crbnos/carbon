import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { Spinner, VStack } from "@carbon/react";
import { Await, useParams } from "@remix-run/react";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { Suspense } from "react";
import { CadModel } from "~/components";
import { usePermissions, useRouteData } from "~/hooks";
import type { Fixture, ItemFile } from "~/modules/items";
import {
  FixtureForm,
  ItemDocuments,
  fixtureValidator,
  upsertFixture,
} from "~/modules/items";
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
    files: Promise<ItemFile[]>;
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
    tags: fixtureData.fixtureSummary?.tags ?? [],
    ...getCustomFields(fixtureData.fixtureSummary?.customFields ?? {}),
  };

  return (
    <VStack spacing={2} className="p-2">
      <FixtureForm
        key={JSON.stringify(fixtureInitialValues)}
        initialValues={fixtureInitialValues}
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
            <Await resolve={fixtureData?.files ?? []}>
              {(resolvedFiles) => (
                <ItemDocuments
                  files={resolvedFiles}
                  itemId={itemId}
                  modelUpload={fixtureData.fixtureSummary}
                  type="Fixture"
                />
              )}
            </Await>
          </Suspense>
          <CadModel
            isReadOnly={!permissions.can("update", "parts")}
            metadata={{
              itemId,
            }}
            modelPath={fixtureData?.fixtureSummary?.modelPath ?? null}
            title="CAD Model"
          />
        </div>
      )}
    </VStack>
  );
}
