import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { useNavigate } from "@remix-run/react";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  requiredActionValidator,
  upsertRequiredAction,
} from "~/modules/quality";
import { RequiredActionForm } from "~/modules/quality/ui/RequiredActions";
import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "quality",
  });

  const formData = await request.formData();
  const validation = await validator(requiredActionValidator).validate(
    formData
  );

  if (validation.error) {
    return json({ success: false, message: "Invalid form data" });
  }

  const { name, active } = validation.data;

  const createResult = await upsertRequiredAction(client, {
    name,
    active: active ?? true,
    companyId,
    createdBy: userId,
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

  const [newRequiredAction] = createResult.data ?? [];

  return redirect(
    path.to.requiredAction(newRequiredAction.id),
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
        active: true,
      }}
      onClose={onClose}
    />
  );
}