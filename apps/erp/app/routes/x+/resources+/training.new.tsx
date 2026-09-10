import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useNavigate } from "react-router";
import {
  TrainingForm,
  trainingValidator,
  upsertTraining
} from "~/modules/resources";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "resources"
  });

  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "resources"
  });
  const formData = await request.formData();
  const validation = await validator(trainingValidator).validate(formData);

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
          "Invalid training content format",
          "Failed to parse training content"
        )
      )
    );
  }

  const insertTraining = await upsertTraining(client, {
    ...d,
    content: contentJSON,
    companyId,
    createdBy: userId
  });

  if (insertTraining.error || !insertTraining.data?.id) {
    return data(
      {},
      await flash(
        request,
        error(insertTraining.error, "Failed to create training")
      )
    );
  }

  return redirect(
    path.to.training(insertTraining.data.id),
    await flash(request, success("Training created"))
  );
}

export default function NewTrainingRoute() {
  const navigate = useNavigate();
  const initialValues = {
    name: "",
    grantsAbilityId: ""
  };

  return (
    <TrainingForm initialValues={initialValues} onClose={() => navigate(-1)} />
  );
}
