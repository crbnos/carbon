import {
  assertIsPost,
  error,
  getCarbonServiceRole,
  success
} from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate } from "react-router";
import { useUrlParams } from "~/hooks";
import { ApprovalRuleForm } from "~/modules/settings";
import {
  approvalRuleValidator,
  getApprovalRuleById,
  getApprovalRules,
  upsertApprovalRule
} from "~/modules/shared";

import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "settings",
    role: "employee"
  });

  const { id } = params;
  if (!id) throw new Error("Rule ID is required");

  const rule = await getApprovalRuleById(client, id, companyId);

  if (rule.error) {
    throw redirect(
      path.to.approvalRules,
      await flash(request, error(rule.error, "Failed to load approval rule"))
    );
  }

  if (!rule.data) {
    throw redirect(
      path.to.approvalRules,
      await flash(request, error(null, "Approval rule not found"))
    );
  }

  return {
    rule: rule.data
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);

  const { companyId, userId } = await requirePermissions(request, {
    update: "settings",
    role: "employee"
  });

  const serviceRole = getCarbonServiceRole();
  const { id } = params;
  if (!id) throw new Error("Rule ID is required");

  const formData = await request.formData();
  const validation = await validator(approvalRuleValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  // Get existing rule to check permissions
  const rules = await getApprovalRules(serviceRole, companyId);
  const existingRule = rules.data?.find((r) => r.id === id);

  if (!existingRule) {
    throw redirect(
      path.to.approvalRules,
      await flash(request, error(null, "Approval rule not found"))
    );
  }

  // Only the creator can edit their own rule
  if (existingRule.createdBy !== userId) {
    throw redirect(
      path.to.approvalRules,
      await flash(
        request,
        error(null, "Only the creator can edit this approval rule")
      )
    );
  }

  const rulesForType =
    rules.data?.filter(
      (r) => r.documentType === validation.data.documentType && r.id !== id
    ) || [];
  const duplicateRule = rulesForType.find(
    (r) => r.lowerBoundAmount === (validation.data.lowerBoundAmount ?? 0)
  );

  if (duplicateRule) {
    return validationError({
      fieldErrors: {
        lowerBoundAmount: `A rule with this minimum amount already exists. The maximum for this rule would be set by the next higher rule.`
      }
    });
  }

  const result = await upsertApprovalRule(serviceRole, {
    id,
    updatedBy: userId,
    documentType: validation.data.documentType,
    enabled: validation.data.enabled,
    approverGroupIds: validation.data.approverGroupIds || [],
    defaultApproverId: validation.data.defaultApproverId,
    lowerBoundAmount: validation.data.lowerBoundAmount ?? 0
  });

  if (result.error) {
    throw redirect(
      `${path.to.approvalRule(id)}?${getParams(request)}`,
      await flash(
        request,
        error(
          result.error,
          result.error?.message ?? "Failed to update approval rule."
        )
      )
    );
  }

  throw redirect(
    `${path.to.approvalRules}?${getParams(request)}`,
    await flash(request, success("Approval rule updated"))
  );
}

export default function EditApprovalRuleRoute() {
  const { rule } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [params] = useUrlParams();
  const onClose = () =>
    navigate(`${path.to.approvalRules}?${params.toString()}`);

  return (
    <ApprovalRuleForm
      rule={rule}
      documentType={rule.documentType}
      onClose={onClose}
    />
  );
}
