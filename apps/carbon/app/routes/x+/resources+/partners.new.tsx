import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { useUrlParams } from "~/hooks";
import {
  PartnerForm,
  partnerValidator,
  upsertPartner,
} from "~/modules/resources";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { setCustomFields } from "~/utils/form";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error, success } from "~/utils/result";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "resources",
  });

  const formData = await request.formData();
  const validation = await validator(partnerValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { supplierId, ...data } = validation.data;

  const createPartner = await upsertPartner(client, {
    ...data,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData),
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
    abilityId: "",
  };

  return <PartnerForm initialValues={initialValues} />;
}
