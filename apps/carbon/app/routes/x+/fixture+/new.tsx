import { validationError, validator } from "@carbon/remix-validated-form";
import type { ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { FixtureForm, fixtureValidator, upsertFixture } from "~/modules/items";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { setCustomFields } from "~/utils/form";
import type { Handle } from "~/utils/handle";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export const handle: Handle = {
  breadcrumb: "Fixtures",
  to: path.to.fixtures,
};

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "parts",
  });

  const formData = await request.formData();
  const modal = formData.get("type") === "modal";

  const validation = await validator(fixtureValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const createFixture = await upsertFixture(client, {
    ...validation.data,
    companyId,
    customFields: setCustomFields(formData),
    createdBy: userId,
  });
  if (createFixture.error) {
    return modal
      ? json(
          createFixture,
          await flash(
            request,
            error(createFixture.error, "Failed to insert fixture")
          )
        )
      : redirect(
          path.to.fixtures,
          await flash(
            request,
            error(createFixture.error, "Failed to insert fixture")
          )
        );
  }

  const itemId = createFixture.data?.itemId;
  if (!itemId) throw new Error("Fixture ID not found");

  return modal
    ? json(createFixture, { status: 201 })
    : redirect(path.to.fixture(itemId));
}

export default function FixturesNewRoute() {
  const initialValues = {
    id: "",
    name: "",
    description: "",
    replenishmentSystem: "Make" as const,
    defaultMethodType: "Make" as const,
    itemTrackingType: "Inventory" as "Inventory",
    unitOfMeasureCode: "EA",
    active: true,
  };

  return (
    <div className="w-1/2 max-w-[600px] min-w-[420px] mx-auto mt-8">
      <FixtureForm initialValues={initialValues} />
    </div>
  );
}
