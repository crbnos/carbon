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
              {isEditing ? "Edit" : "New"} Approval Rule
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
                    label="Minimum Amount"
                    formatOptions={{
                      style: "currency",
                      currency: baseCurrencyCode
                    }}
                  />
                )}

              <Users
                name="approverGroupIds"
                label="Approvers"
                type="employee"
                placeholder="Select approver groups"
              />

              <Employee
                name="defaultApproverId"
                label="Default Approver"
                placeholder="Select a default approver"
              />

              <FormBoolean
                name="enabled"
                label="Enabled"
                helperText="Enable this rule to automatically require approval for matching documents"
                variant="large"
              />
              {/* <FormNumber
                name="escalationDays"
                label="Escalation Days"
                helperText="Automatically escalate approval requests after this many days. Leave empty to disable escalation."
              /> */}
            </VStack>
          </DrawerBody>
          <DrawerFooter>
            <HStack>
              <Submit isDisabled={isDisabled}>
                {isEditing ? "Update" : "Create"} Rule
              </Submit>
              <Button variant="secondary" onClick={onClose}>
                Cancel
              </Button>
            </HStack>
          </DrawerFooter>
        </ValidatedForm>
      </DrawerContent>
    </Drawer>
  );
};

export default ApprovalRuleForm;
