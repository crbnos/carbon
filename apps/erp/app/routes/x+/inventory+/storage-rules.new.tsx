import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { requirePlan } from "@carbon/ee/plan.server";
import { validator } from "@carbon/form";
import type { TargetType } from "@carbon/utils";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs,
  LoaderFunctionArgs
} from "react-router";
import { redirect, useLoaderData, useNavigate } from "react-router";
import {
  storageRuleValidator,
  upsertStorageRule
} from "~/modules/storage-rules";
import StorageRuleForm from "~/modules/storage-rules/ui/StorageRuleForm";
import { getParams, path } from "~/utils/path";
import { getCompanyId, storageRulesQuery } from "~/utils/react-query";

const isTargetType = (value: string | null): value is TargetType =>
  value === "item" || value === "workCenter";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, { create: "inventory" });
  const url = new URL(request.url);
  const raw = url.searchParams.get("targetType");
  return { targetType: isTargetType(raw) ? raw : ("item" as TargetType) };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "inventory"
  });

  await requirePlan({
    request,
    client,
    companyId,
    feature: "STORAGE_RULES",
    redirectTo: path.to.storageRules
  });

  const formData = await request.formData();
  const validation = await validator(storageRuleValidator).validate(formData);
  if (validation.error) return validation.error;

  const insert = await upsertStorageRule(client, {
    ...validation.data,
    description: validation.data.description ?? null,
    companyId,
    createdBy: userId
  });

  if (insert.error) {
    return await flash(
      request,
      error(insert.error, "Failed to create rule")
    ).then(() => null);
  }

  throw redirect(`${path.to.storageRules}?${getParams(request)}`);
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  window?.clientCache?.setQueryData(
    storageRulesQuery(getCompanyId()).queryKey,
    null
  );
  return await serverAction();
}

export default function NewStorageRuleRoute() {
  const { targetType } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  // navigate(-1) breaks when the page was opened directly (no history entry
  // to pop). Always navigate forward to the parent list route — closes the
  // drawer regardless of how the user got here.
  return (
    <StorageRuleForm
      initialValues={{ targetType }}
      onClose={() => navigate(path.to.storageRules)}
    />
  );
}
