import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { useUrlParams } from "~/hooks";
import { PartnerForm, partnerValidator } from "~/modules/resources";
import { upsertPartner } from "~/modules/resources/resources.service.server";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    create: "resources"
  });

  const formData = await request.formData();
  const validation = await validator(partnerValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { supplierId, ...d } = validation.data;

  const createPartner = await upsertPartner({
    ...d,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });

  if (createPartner.error) {
    throw redirect(
      path.to.partners,
      await flash(
        request,
        error(createPartner.error, "Failed to create partner")
      )
    );
  }

  throw redirect(
    path.to.partners,
    await flash(request, success("Partner created"))
  );
}

export default function NewPartnerRoute() {
  const [params] = useUrlParams();
  const initialValues = {
    id: params.get("id") ?? "",
    supplierId: params.get("supplierId") ?? "",
    hoursPerWeek: 0,
    abilityId: ""
  };

  return <PartnerForm initialValues={initialValues} />;
}
