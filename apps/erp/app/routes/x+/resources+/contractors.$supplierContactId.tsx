import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import {
  ContractorForm,
  contractorValidator,
  getContractor,
  upsertContractor
} from "~/modules/resources";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "resources"
  });

  const { supplierContactId } = params;
  if (!supplierContactId) throw notFound("supplierContactId not found");

  const contractor = await getContractor(client, supplierContactId);

  if (contractor.error) {
    throw redirect(
      path.to.contractors,
      await flash(request, error(contractor.error, "Failed to get contractor"))
    );
  }

  return {
    contractor: contractor.data
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "resources"
  });

  const formData = await request.formData();
  const validation = await validator(contractorValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, supplierId, ...d } = validation.data;
  if (!id) throw notFound("Contractor ID was not found");

  const updateContractor = await upsertContractor(client, {
    id,
    ...d,
    // @ts-expect-error TS2339 - TODO: fix type
    abilities: d.abilities ?? [],
    customFields: setCustomFields(formData),
    companyId,
    updatedBy: userId
  });

  if (updateContractor.error) {
    throw redirect(
      path.to.contractors,
      await flash(
        request,
        error(updateContractor.error, "Failed to create contractor")
      )
    );
  }

  throw redirect(
    path.to.contractors,
    await flash(request, success("Contractor updated"))
  );
}

export default function ContractorRoute() {
  const { contractor } = useLoaderData<typeof loader>();

  const initialValues = {
    id: contractor.supplierContactId ?? "",
    supplierId: contractor.supplierId ?? "",
    hoursPerWeek: contractor.hoursPerWeek ?? 0,
    abilities: contractor.abilityIds ?? ([] as string[]),
    ...getCustomFields(contractor.customFields)
  };

  return (
    <ContractorForm key={initialValues.id} initialValues={initialValues} />
  );
}
