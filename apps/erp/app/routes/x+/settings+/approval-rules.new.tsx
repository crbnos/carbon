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
import { ApprovalRuleForm } from "~/modules/settings";
import {
  type ApprovalDocumentType,
  approvalRuleValidator,
  getApprovalRules,
  upsertApprovalRule
} from "~/modules/shared";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "settings",
    role: "employee"
  });

  const url = new URL(request.url);
  const typeParam = url.searchParams.get("type");
  const documentType: ApprovalDocumentType | null =
    typeParam === "purchaseOrder" || typeParam === "qualityDocument"
      ? typeParam
      : null;

  return {
    rule: null,
    documentType: documentType as ApprovalDocumentType | null
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);

  const { companyId, userId } = await requirePermissions(request, {
    update: "settings",
    role: "employee"
  });

  const serviceRole = getCarbonServiceRole();

  const formData = await request.formData();
  const validation = await validator(approvalRuleValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const existingRules = await getApprovalRules(serviceRole, companyId);
  const rulesForType =
    existingRules.data?.filter(
      (r) => r.documentType === validation.data.documentType
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
    createdBy: userId,
    companyId,
    documentType: validation.data.documentType,
    enabled: validation.data.enabled,
    approverGroupIds: validation.data.approverGroupIds || [],
    defaultApproverId: validation.data.defaultApproverId,
    lowerBoundAmount: validation.data.lowerBoundAmount ?? 0
  });

  if (result.error) {
    throw redirect(
      path.to.approvalRules,
      await flash(
        request,
        error(
          result.error,
          result.error?.message ?? "Failed to create approval rule."
        )
      )
    );
  }

  throw redirect(
    path.to.approvalRules,
    await flash(request, success("Approval rule created"))
  );
}

export default function NewApprovalRuleRoute() {
  const { rule, documentType } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const onClose = () => navigate(path.to.approvalRules);

  return (
    <ApprovalRuleForm
      rule={rule}
      documentType={documentType}
      onClose={onClose}
    />
  );
}
