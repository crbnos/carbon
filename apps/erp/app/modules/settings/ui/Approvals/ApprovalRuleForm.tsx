import {
  Boolean as FormBoolean,
  Number as FormNumber,
  Hidden,
  Submit,
  ValidatedForm
} from "@carbon/form";
import {
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  HStack,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Employee, Users } from "~/components/Form";
import { usePermissions, useUser } from "~/hooks";
import type { ApprovalRule } from "~/modules/shared";
import {
  type ApprovalDocumentType,
  approvalDocumentTypesWithAmounts,
  approvalRuleValidator
} from "~/modules/shared";
import { path } from "~/utils/path";

type ApprovalRuleFormProps = {
  rule: ApprovalRule | null;
  documentType: ApprovalDocumentType | null;
  onClose: () => void;
};

const ApprovalRuleForm = ({
  rule,
  documentType,
  onClose
}: ApprovalRuleFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const {
    company: { baseCurrencyCode }
  } = useUser();
  const isEditing = !!rule?.id;
  const isDisabled = !permissions.can("update", "settings");
  const effectiveDocumentType = rule?.documentType || documentType;
  const defaultValues = rule
    ? {
        id: rule.id,
        documentType: rule.documentType,
        enabled: rule.enabled ?? false,
        approverGroupIds: Array.isArray(rule.approverGroupIds)
          ? rule.approverGroupIds
          : [],
        defaultApproverId: rule.defaultApproverId ?? undefined,
        lowerBoundAmount: rule.lowerBoundAmount ?? 0,
        escalationDays: rule.escalationDays ?? undefined
      }
    : {
        name: "",
        documentType: documentType || undefined,
        enabled: true,
        approverGroupIds: [],
        lowerBoundAmount: 0,
        escalationDays: undefined
      };

  return (
    <Drawer open onOpenChange={(open) => !open && onClose()}>
      <DrawerContent>
        <ValidatedForm
          validator={approvalRuleValidator}
          method="post"
          action={
            isEditing
              ? path.to.approvalRule(rule.id)
              : path.to.newApprovalRule()
          }
          defaultValues={defaultValues}
          className="flex flex-col h-full"
        >
          <DrawerHeader>
            <DrawerTitle>
              {isEditing ? (
                <Trans>Edit Approval Rule</Trans>
              ) : (
                <Trans>New Approval Rule</Trans>
              )}
            </DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <VStack spacing={4} className="items-stretch">
              {isEditing && rule?.id && <Hidden name="id" value={rule.id} />}

              {effectiveDocumentType && (
                <Hidden name="documentType" value={effectiveDocumentType} />
              )}

              {/* Purchase Order Specific Fields */}
              {effectiveDocumentType &&
                approvalDocumentTypesWithAmounts.includes(
                  effectiveDocumentType
                ) && (
                  <FormNumber
                    name="lowerBoundAmount"
                    label={t`Minimum Amount`}
                    helperText={t`Approval is required at or above this amount, up to the next rule's minimum`}
                    formatOptions={{
                      style: "currency",
                      currency: baseCurrencyCode
                    }}
                  />
                )}

              <Users
                name="approverGroupIds"
                label={t`Who Can Approve`}
                type="employee"
                placeholder={t`Select groups or individuals`}
                helperText={t`All members of selected groups and selected individuals will be able to approve requests`}
              />

              <Employee
                name="defaultApproverId"
                label={t`Default Approver`}
                placeholder={t`Select a default approver`}
              />

              <FormBoolean
                name="enabled"
                label={t`Enabled`}
                helperText={t`Enable this rule to automatically require approval for matching documents`}
                variant="large"
              />
              {/* <FormNumber
                name="escalationDays"
                label={t`Escalation Days`}
                helperText="Automatically escalate approval requests after this many days. Leave empty to disable escalation."
              /> */}
            </VStack>
          </DrawerBody>
          <DrawerFooter>
            <HStack>
              <Submit isDisabled={isDisabled}>
                {isEditing ? (
                  <Trans>Update Rule</Trans>
                ) : (
                  <Trans>Create Rule</Trans>
                )}
              </Submit>
              <Button variant="secondary" onClick={onClose}>
                <Trans>Cancel</Trans>
              </Button>
            </HStack>
          </DrawerFooter>
        </ValidatedForm>
      </DrawerContent>
    </Drawer>
  );
};

export default ApprovalRuleForm;
