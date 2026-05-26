import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { PartnerForm, partnerValidator } from "~/modules/resources";
import {
  getPartner,
  upsertPartner
} from "~/modules/resources/resources.service.server";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "resources"
  });

  const { supplierLocationId, abilityId } = params;
  if (!supplierLocationId) throw notFound("Partner ID was not found");
  if (!abilityId) throw notFound("Ability ID was not found");

  const partner = await getPartner(supplierLocationId, abilityId);

  if (partner.error) {
    throw redirect(
      path.to.partners,
      await flash(request, error(partner.error, "Failed to get partner"))
    );
  }

  return {
    partner: partner.data
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId } = await requirePermissions(request, {
    create: "resources"
  });

  const formData = await request.formData();
  const validation = await validator(partnerValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { supplierId, ...d } = validation.data;

  const updatePartner = await upsertPartner({
    ...d,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });

  if (updatePartner.error) {
    throw redirect(
      path.to.partners,
      await flash(
        request,
        error(updatePartner.error, "Failed to create partner")
      )
    );
  }

  throw redirect(
    path.to.partners,
    await flash(request, success("Partner updated"))
  );
}

export default function PartnerRoute() {
  const { partner } = useLoaderData<typeof loader>();

  const initialValues = {
    id: partner.supplierLocationId ?? "",
    supplierId: partner.supplierId ?? "",
    hoursPerWeek: partner.hoursPerWeek ?? 0,
    abilityId: partner.abilityId ?? "",
    ...getCustomFields(partner.customFields)
  };

  return <PartnerForm key={initialValues.id} initialValues={initialValues} />;
}
