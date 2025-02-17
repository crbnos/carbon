import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useNavigate } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { procedureValidator } from "~/modules/production/production.models";
import { upsertProcedure } from "~/modules/production/production.service";
import ProcedureForm from "~/modules/production/ui/Procedures/ProcedureForm";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "production",
  });

  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "production",
  });

  const formData = await request.formData();
  const validation = await validator(procedureValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;

  const insertProcedure = await upsertProcedure(client, {
    ...data,
    companyId,
    createdBy: userId,
  });
  if (insertProcedure.error || !insertProcedure.data?.id) {
    return json(
      {},
      await flash(
        request,
        error(insertProcedure.error, "Failed to insert procedure")
      )
    );
  }

  return redirect(
    path.to.procedure(insertProcedure.data.id),
    await flash(request, success("Procedure created"))
  );
}

export default function NewProcedureRoute() {
  const navigate = useNavigate();
  const initialValues = {
    name: "",
    version: 0,
    processId: "",
  };

  return (
    <ProcedureForm initialValues={initialValues} onClose={() => navigate(-1)} />
  );
}
