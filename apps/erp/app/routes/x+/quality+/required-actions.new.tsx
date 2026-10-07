// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { useNavigate } from "react-router";
import {
  requiredActionValidator,
  upsertRequiredAction
} from "~/modules/quality";
import { RequiredActionForm } from "~/modules/quality/ui/RequiredActions";
import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "quality"
  });

  const formData = await request.formData();
  const validation = await validator(requiredActionValidator).validate(
    formData
  );

  if (validation.error) {
    return { success: false, message: "Invalid form data" };
  }

  const { name, active } = validation.data;

  const createResult = await upsertRequiredAction(client, {
    name,
    active: active ?? true,
    companyId,
    createdBy: userId
  });

  if (createResult.error) {
    return redirect(
      path.to.requiredActions,
      await flash(
        request,
        error(createResult.error, "Failed to create required action")
      )
    );
  }

  return redirect(
    path.to.requiredActions,
    await flash(request, success("Required action created successfully"))
  );
}

export default function NewRequiredActionRoute() {
  const navigate = useNavigate();
  const onClose = () => navigate(path.to.requiredActions);

  return (
    <RequiredActionForm
      type="modal"
      initialValues={{
        name: "",
        active: true
      }}
      onClose={onClose}
    />
  );
}
