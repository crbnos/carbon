import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  trainingQuestionValidator,
  upsertTrainingQuestion
} from "~/modules/resources";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    create: "resources"
  });

  const { id: trainingId } = params;
  if (!trainingId) throw new Error("id is not found");

  const formData = await request.formData();

  // Handle arrays from form data
  const options = formData.getAll("options[]") as string[];
  const correctAnswers = formData.getAll("correctAnswers[]") as string[];

  const validation = await validator(trainingQuestionValidator).validate(
    formData
  );

  if (validation.error) {
    return data(
      { success: false },
      await flash(request, error(validation.error, "Failed to create question"))
    );
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, matchingPairs, correctBoolean, ...rest } = validation.data;

  // Parse matchingPairs if it's a string
  let parsedMatchingPairs = null;
  if (matchingPairs) {
    try {
      parsedMatchingPairs = JSON.parse(matchingPairs);
    } catch {
      parsedMatchingPairs = null;
    }
  }

  const create = await upsertTrainingQuestion({
    ...rest,
    options: options.length > 0 ? options : rest.options,
    correctAnswers:
      correctAnswers.length > 0 ? correctAnswers : rest.correctAnswers,
    matchingPairs: parsedMatchingPairs,
    // @ts-expect-error correctBoolean can be string or boolean we already validate in zod, can remove here
    correctBoolean: correctBoolean === true || correctBoolean === "true",
    companyId,
    createdBy: userId
  });

  if (create.error) {
    return data(
      {
        success: false
      },
      await flash(
        request,
        error(create.error, "Failed to insert training question")
      )
    );
  }

  return { success: true };
}
