// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { deleteTrainingQuestion } from "~/modules/resources";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    delete: "resources"
  });

  const { questionId } = params;

  if (!questionId) throw new Error("questionId is not found");

  const deleteQuestion = await deleteTrainingQuestion(
    client,
    questionId,
    companyId
  );

  if (deleteQuestion.error) {
    return data(
      {
        success: false
      },
      await flash(
        request,
        error(deleteQuestion.error, "Failed to delete question")
      )
    );
  }

  return data(
    {
      success: true
    },
    await flash(request, success("Successfully deleted question"))
  );
}
