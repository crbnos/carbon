import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { ScrollArea } from "@carbon/react";
import { useNavigate } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { nonConformanceWorkflowValidator } from "~/modules/quality/quality.models";
import { upsertNonConformanceWorkflow } from "~/modules/quality/quality.service";
import NonConformanceWorkflowForm from "~/modules/quality/ui/NonConformanceWorkflows/NonConformanceWorkflowForm";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "quality",
  });

  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "quality",
  });
  const formData = await request.formData();
  const validation = await validator(nonConformanceWorkflowValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;

  const insertNonConformanceWorkflow = await upsertNonConformanceWorkflow(
    client,
    {
      ...data,
      companyId,
      createdBy: userId,
    }
  );

  if (
    insertNonConformanceWorkflow.error ||
    !insertNonConformanceWorkflow.data?.id
  ) {
    return json(
      {},
      await flash(
        request,
        error(
          insertNonConformanceWorkflow.error,
          "Failed to insert non-conformance workflow"
        )
      )
    );
  }

  return redirect(
    path.to.nonConformanceWorkflow(insertNonConformanceWorkflow.data.id),
    await flash(request, success("Non-conformance workflow created"))
  );
}

export default function NewNonConformanceWorkflowRoute() {
  const navigate = useNavigate();
  const initialValues = {
    name: "",
    content: "{}",
    investigationTypes: [],
    requiredActions: [],
    approvalRequirements: [],
  };

  return (
    <ScrollArea className="w-full h-[calc(100dvh-49px)] bg-card">
      <NonConformanceWorkflowForm
        initialValues={initialValues}
        onClose={() => navigate(-1)}
      />
    </ScrollArea>
  );
}
