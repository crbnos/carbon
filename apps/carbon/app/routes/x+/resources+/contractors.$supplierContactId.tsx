import { validationError, validator } from "@carbon/form";
import { useLoaderData } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  ContractorForm,
  contractorValidator,
  getContractor,
  upsertContractor,
} from "~/modules/resources";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { assertIsPost, notFound } from "~/utils/http";
import { path } from "~/utils/path";
import { error, success } from "~/utils/result";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "resources",
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

  return json({
    contractor: contractor.data,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    create: "resources",
  });

  const formData = await request.formData();
  const validation = await validator(contractorValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, supplierId, ...data } = validation.data;
  if (!id) throw notFound("Contractor ID was not found");

  const updateContractor = await upsertContractor(client, {
    id,
    ...data,
    abilities: data.abilities ?? [],
    customFields: setCustomFields(formData),
    updatedBy: userId,
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
    ...getCustomFields(contractor.customFields),
  };

  return (
    <ContractorForm key={initialValues.id} initialValues={initialValues} />
  );
}
