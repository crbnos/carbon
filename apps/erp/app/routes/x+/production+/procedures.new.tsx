import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs,
  LoaderFunctionArgs
} from "react-router";
import { data, redirect, useNavigate } from "react-router";
import { procedureValidator } from "~/modules/production/production.models";
import { upsertProcedure } from "~/modules/production/production.service";
import ProcedureForm from "~/modules/production/ui/Procedures/ProcedureForm";
import { path } from "~/utils/path";
import { getCompanyId, proceduresQuery } from "~/utils/react-query";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "production"
  });

  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "production"
  });
  const formData = await request.formData();
  const validation = await validator(procedureValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, content, ...d } = validation.data;

  let contentJSON;
  try {
    contentJSON = content ? JSON.parse(content) : {};
    // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  } catch (e) {
    return data(
      {},
      await flash(
        request,
        error(
          "Invalid procedure content format",
          "Failed to parse procedure content"
        )
      )
    );
  }

  const insertProcedure = await upsertProcedure(client, {
    ...d,
    content: contentJSON,
    companyId,
    createdBy: userId
  });

  if (insertProcedure.error || !insertProcedure.data?.id) {
    return data(
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

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  window.clientCache?.setQueryData(
    proceduresQuery(getCompanyId()).queryKey,
    null
  );
  return await serverAction();
}

export default function NewProcedureRoute() {
  const navigate = useNavigate();
  const initialValues = {
    name: "",
    version: 0,
    processId: ""
  };

  return (
    <ProcedureForm
      initialValues={initialValues}
      type="new"
      onClose={() => navigate(path.to.procedures)}
    />
  );
}
