import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import { NotificationEvent } from "@carbon/notifications";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData, useNavigate } from "react-router";
import invariant from "tiny-invariant";
import { riskRegisterValidator } from "~/modules/quality/quality.models";
import { getRisk, upsertRisk } from "~/modules/quality/quality.service";
import RiskRegisterForm from "~/modules/quality/ui/RiskRegister/RiskRegisterForm";
import { getParams, path } from "~/utils/path";

const logger = getLogger("erp", "risks-id");

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { client } = await requirePermissions(request, {
    view: "quality",
    role: "employee"
  });
  const { id } = params;
  invariant(id, "id is required");

  const risk = await getRisk(client, id);
  if (risk.error || !risk.data) {
    throw new Response("Not Found", { status: 404 });
  }

  return data({ risk: risk.data });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { client, userId, companyId } = await requirePermissions(request, {
    update: "quality",
    role: "employee"
  });

  const formData = await request.formData();
  const validation = await validator(riskRegisterValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const riskId = validation.data.id!;

  // Get the previous assignee to check if it changed
  const existingRisk = await getRisk(client, riskId);
  const previousAssignee = existingRisk.data?.assignee;

  const severity = parseInt(validation.data.severity ?? "1", 10);
  const likelihood = parseInt(validation.data.likelihood ?? "1", 10);

  const result = await upsertRisk(client, {
    ...validation.data,
    id: riskId,
    assignee: validation.data.assignee || undefined,
    severity,
    likelihood,
    companyId,
    updatedBy: userId
  });

  if (result.error) {
    throw redirect(
      path.to.risks,
      await flash(request, error(result.error, "Failed to update risk"))
    );
  }

  // Notify the new assignee if it changed
  const newAssignee = validation.data.assignee;
  if (newAssignee && newAssignee !== previousAssignee) {
    try {
      await trigger("notify", {
        companyId,
        documentId: riskId,
        event: NotificationEvent.RiskAssignment,
        recipient: {
          type: "user",
          userId: newAssignee
        },
        from: userId
      });
    } catch (err) {
      logger.error("Failed to notify assignee", { error: err });
    }
  }

  throw redirect(
    `${path.to.risks}?${getParams(request)}`,
    await flash(request, success("Risk updated successfully"))
  );
};

export default function EditRiskRoute() {
  const { risk } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const onClose = () => {
    navigate(-1);
  };

  return (
    <RiskRegisterForm
      open
      // @ts-expect-error TS2322 - TODO: fix type
      initialValues={{
        ...risk,
        id: risk.id,
        title: risk.title || "",
        description: risk.description ?? undefined,
        itemId: risk.itemId ?? undefined,
        source: risk.source,
        status: risk.status || "Open",
        severity: risk.severity ? risk.severity.toString() : "1",
        likelihood: risk.likelihood ? risk.likelihood.toString() : "1",
        assignee: risk.assignee ?? undefined,
        sourceId: risk.sourceId ?? undefined,
        type: risk.type ?? "Risk"
      }}
      onClose={onClose}
    />
  );
}
