import { validationError, validator } from "@carbon/form";
import { useNavigate } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { ApiKeyForm, apiKeyValidator, upsertApiKey } from "~/modules/settings";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { assertIsPost } from "~/utils/http";
import { error } from "~/utils/result";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    update: "users",
  });

  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "users",
  });

  const formData = await request.formData();
  const validation = await validator(apiKeyValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;

  const insertApiKey = await upsertApiKey(client, {
    ...data,
    companyId,
    createdBy: userId,
  });
  if (insertApiKey.error) {
    return json(
      {},
      await flash(
        request,
        error(insertApiKey.error, "Failed to create API key")
      )
    );
  }

  const key = insertApiKey.data?.key;
  if (!key) {
    return json(
      {},
      await flash(request, error(insertApiKey, "Failed to create API key"))
    );
  }

  return json({ key }, { status: 201 });
}

export default function NewApiKeyRoute() {
  const navigate = useNavigate();
  const initialValues = {
    name: "",
  };

  return (
    <ApiKeyForm onClose={() => navigate(-1)} initialValues={initialValues} />
  );
}
