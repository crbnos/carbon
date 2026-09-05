import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import { NotificationEvent } from "@carbon/notifications";
import { useDisclosure } from "@carbon/react";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { riskRegisterValidator } from "~/modules/quality/quality.models";
import { upsertRisk } from "~/modules/quality/quality.service";
import RiskRegisterForm from "~/modules/quality/ui/RiskRegister/RiskRegisterForm";
import { getParams, path } from "~/utils/path";

const logger = getLogger("erp", "risks-new");

export const action = async ({ request }: ActionFunctionArgs) => {
  const { client, userId, companyId } = await requirePermissions(request, {
    role: "employee"
  });

  const formData = await request.formData();
  const validation = await validator(riskRegisterValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id: _, ...d } = validation.data;

  const severity = parseInt(d.severity ?? "1", 10);
  const likelihood = parseInt(d.likelihood ?? "1", 10);

  const result = await upsertRisk(client, {
    ...d,
    assignee: d.assignee ?? userId,
    severity,
    likelihood,
    companyId,
    createdBy: userId
  });

  if (result.error) {
    throw redirect(
      path.to.risks,
      await flash(request, error(result.error, "Failed to create risk"))
    );
  }

  // Notify the assignee if one was set
  if (d.assignee && result.data?.id) {
    try {
      await trigger("notify", {
        companyId,
        documentId: result.data.id,
        event: NotificationEvent.RiskAssignment,
        recipient: {
          type: "user",
          userId: d.assignee
        },
        from: userId
      });
    } catch (err) {
      logger.error("Failed to notify assignee", { error: err });
    }
  }

  throw redirect(
    `${path.to.risks}?${getParams(request)}`,
    await flash(request, success("Risk created successfully"))
  );
};

export default function NewRiskRoute() {
  const formDisclosure = useDisclosure({
    defaultIsOpen: true
  });
  const onClose = () => {
    formDisclosure.onClose();
  };

  return (
    <RiskRegisterForm
      open={formDisclosure.isOpen}
      initialValues={{
        title: "",
        description: "",
        source: "General",
        status: "Open",
        severity: "1",
        likelihood: "1",
        type: "Risk"
      }}
      onClose={onClose}
    />
  );
}
