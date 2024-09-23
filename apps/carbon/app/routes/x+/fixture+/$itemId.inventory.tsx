import { validationError, validator } from "@carbon/form";
import { VStack } from "@carbon/react";
import { useLoaderData } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { useRouteData } from "~/hooks";
import { InventoryDetails } from "~/modules/inventory";
import type { Fixture, UnitOfMeasureListItem } from "~/modules/items";
import {
  PickMethodForm,
  getItemQuantities,
  getItemShelfQuantities,
  getPickMethod,
  pickMethodValidator,
  upsertPickMethod,
} from "~/modules/items";
import { getLocationsList } from "~/modules/resources";
import { getUserDefaults } from "~/modules/users/users.server";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import type { ListItem } from "~/types";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error, success } from "~/utils/result";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "parts",
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  let locationId = searchParams.get("location");

  if (!locationId) {
    const userDefaults = await getUserDefaults(client, userId, companyId);
    if (userDefaults.error) {
      throw redirect(
        path.to.fixture(itemId),
        await flash(
          request,
          error(userDefaults.error, "Failed to load default location")
        )
      );
    }

    locationId = userDefaults.data?.locationId ?? null;
  }

  if (!locationId) {
    const locations = await getLocationsList(client, companyId);
    if (locations.error || !locations.data?.length) {
      throw redirect(
        path.to.fixture(itemId),
        await flash(
          request,
          error(locations.error, "Failed to load any locations")
        )
      );
    }
    locationId = locations.data?.[0].id as string;
  }

  let [fixtureInventory] = await Promise.all([
    getPickMethod(client, itemId, companyId, locationId),
  ]);

  if (fixtureInventory.error || !fixtureInventory.data) {
    const insertPickMethod = await upsertPickMethod(client, {
      itemId,
      companyId,
      locationId,
      customFields: {},
      createdBy: userId,
    });

    if (insertPickMethod.error) {
      throw redirect(
        path.to.fixture(itemId),
        await flash(
          request,
          error(insertPickMethod.error, "Failed to insert fixture inventory")
        )
      );
    }

    fixtureInventory = await getPickMethod(
      client,
      itemId,
      companyId,
      locationId
    );
    if (fixtureInventory.error || !fixtureInventory.data) {
      throw redirect(
        path.to.fixture(itemId),
        await flash(
          request,
          error(fixtureInventory.error, "Failed to load fixture inventory")
        )
      );
    }
  }

  const quantities = await getItemQuantities(
    client,
    itemId,
    companyId,
    locationId
  );
  if (quantities.error) {
    throw redirect(
      path.to.items,
      await flash(
        request,
        error(quantities, "Failed to load fixture quantities")
      )
    );
  }

  const itemShelfQuantities = await getItemShelfQuantities(
    client,
    itemId,
    companyId,
    locationId
  );
  if (itemShelfQuantities.error || !itemShelfQuantities.data) {
    throw redirect(
      path.to.items,
      await flash(
        request,
        error(quantities, "Failed to load fixture quantities")
      )
    );
  }

  return json({
    fixtureInventory: fixtureInventory.data,
    itemShelfQuantities: itemShelfQuantities.data,
    quantities: quantities.data,
    itemId,
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
  // validate with fixturesValidator
  const validation = await validator(pickMethodValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { ...update } = validation.data;

  const updatePickMethod = await upsertPickMethod(client, {
    ...update,
    itemId,
    customFields: setCustomFields(formData),
    updatedBy: userId,
  });
  if (updatePickMethod.error) {
    throw redirect(
      path.to.fixture(itemId),
      await flash(
        request,
        error(updatePickMethod.error, "Failed to update fixture inventory")
      )
    );
  }

  throw redirect(
    path.to.fixtureInventoryLocation(itemId, update.locationId),
    await flash(request, success("Updated fixture inventory"))
  );
}

export default function FixtureInventoryRoute() {
  const sharedFixturesData = useRouteData<{
    locations: ListItem[];
    shelves: ListItem[];
    unitOfMeasures: UnitOfMeasureListItem[];
  }>(path.to.fixtureRoot);

  const { fixtureInventory, itemShelfQuantities, quantities, itemId } =
    useLoaderData<typeof loader>();

  const fixtureData = useRouteData<{
    fixtureSummary: Fixture;
  }>(path.to.fixture(itemId));
  if (!fixtureData) throw new Error("Could not find fixture data");
  const itemUnitOfMeasureCode = fixtureData?.fixtureSummary?.unitOfMeasureCode;

  const initialValues = {
    ...fixtureInventory,
    defaultShelfId: fixtureInventory.defaultShelfId ?? undefined,
    ...getCustomFields(fixtureInventory.customFields ?? {}),
  };
  return (
    <VStack spacing={2} className="p-2">
      <PickMethodForm
        key={initialValues.itemId}
        initialValues={initialValues}
        locations={sharedFixturesData?.locations ?? []}
        shelves={sharedFixturesData?.shelves ?? []}
        type="Fixture"
      />
      <InventoryDetails
        itemShelfQuantities={itemShelfQuantities}
        itemUnitOfMeasureCode={itemUnitOfMeasureCode ?? "EA"}
        locations={sharedFixturesData?.locations ?? []}
        pickMethod={initialValues}
        quantities={quantities}
        shelves={sharedFixturesData?.shelves ?? []}
        unitOfMeasures={sharedFixturesData?.unitOfMeasures ?? []}
      />
    </VStack>
  );
}
