import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { useUrlParams } from "~/hooks";
import {
  ContractorForm,
  contractorValidator,
  upsertContractor,
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
  const validation = await validator(contractorValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, hoursPerWeek, abilities } = validation.data;

  const createContractor = await upsertContractor(client, {
    id,
    hoursPerWeek,
    abilities: abilities ?? [],
    customFields: setCustomFields(formData),
    companyId,
    createdBy: userId,
  });

  if (createContractor.error) {
    throw redirect(
      path.to.contractors,
      await flash(
        request,
        error(createContractor.error, "Failed to create contractor")
      )
    );
  }

  throw redirect(
    path.to.contractors,
    await flash(request, success("Contractor created"))
  );
}

export default function NewContractorRoute() {
  const [params] = useUrlParams();
  const initialValues = {
    id: params.get("id") ?? "",
    supplierId: params.get("supplierId") ?? "",
    hoursPerWeek: 0,
    abilities: [] as string[],
  };

  return <ContractorForm initialValues={initialValues} />;
}
