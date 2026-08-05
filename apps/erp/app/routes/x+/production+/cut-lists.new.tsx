import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData, useNavigate } from "react-router";
import {
  cutListValidator,
  getCuttingProcessesList,
  upsertCutList
} from "~/modules/production";
import CutListForm from "~/modules/production/ui/CutLists/CutListForm";
import { getNextSequence } from "~/modules/settings";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    create: "production"
  });

  const processes = await getCuttingProcessesList(client, companyId);

  return { processes: processes.data ?? [] };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "production"
  });

  const formData = await request.formData();
  const validation = await validator(cutListValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: id is create-only
  const { id, ...d } = validation.data;

  const sequence = await getNextSequence(client, "cutList", companyId);
  if (sequence.error || !sequence.data) {
    return data(
      {},
      await flash(
        request,
        error(sequence.error, "Failed to generate cut list id")
      )
    );
  }

  const created = await upsertCutList(client, {
    ...d,
    cutListId: sequence.data as string,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });

  if (created.error || !created.data?.id) {
    return data(
      {},
      await flash(request, error(created.error, "Failed to create cut list"))
    );
  }

  throw redirect(
    path.to.cutList(created.data.id),
    await flash(request, success("Cut list created"))
  );
}

export default function NewCutListRoute() {
  const { processes } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const initialValues = {
    processId: "",
    locationId: "",
    workCenterId: "",
    kerf: 0,
    endTrim: 0,
    gripMargin: 0,
    minRemnantLength: 0,
    unitOfDimension: "in" as const,
    assignee: ""
  };

  return (
    <CutListForm
      initialValues={initialValues}
      processes={processes}
      onClose={() => navigate(path.to.cutLists)}
    />
  );
}
