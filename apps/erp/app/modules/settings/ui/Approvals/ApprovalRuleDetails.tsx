import { cn, HStack, VStack } from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { memo } from "react";
import {
  LuCalendar,
  LuCircleCheck,
  LuDollarSign,
  LuUser,
  LuUsers
} from "react-icons/lu";
import { EmployeeAvatar } from "~/components";
import { UserSelect } from "~/components/Selectors";
import type { ApprovalDocumentType, ApprovalRule } from "~/modules/shared";

type ApprovalRuleDetailsProps = {
  rule: ApprovalRule & { approverGroupNames?: string[] };
  documentType: ApprovalDocumentType;
  currencyFormatter: Intl.NumberFormat;
};

type FieldItemProps = {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
  className?: string;
};

const FieldItem = memo(
  ({ icon: Icon, label, children, className }: FieldItemProps) => (
    <VStack spacing={2} className={cn("w-full justify-start", className)}>
      <HStack spacing={2} className="items-center">
        <div className="flex items-center justify-center w-6 h-6 rounded-md bg-muted/50 shrink-0">
          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
        <p className="text-xs font-medium text-muted-foreground leading-tight">
          {label}
        </p>
      </HStack>
      <div className="pl-8 w-full">{children}</div>
    </VStack>
  )
);

FieldItem.displayName = "FieldItem";

const ApprovalRuleDetails = memo(
  ({ rule, documentType, currencyFormatter }: ApprovalRuleDetailsProps) => {
    return (
      <VStack spacing={4} className="w-full">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
          {documentType === "purchaseOrder" && (
            <FieldItem icon={LuDollarSign} label="Minimum Amount">
              <p className="text-sm font-semibold text-foreground leading-relaxed">
                {currencyFormatter.format(rule.lowerBoundAmount ?? 0)}
              </p>
            </FieldItem>
          )}

          {/* Approver Groups */}
          <FieldItem icon={LuUsers} label="Approvers">
            {rule.approverGroupIds && rule.approverGroupIds.length > 0 ? (
              <UserSelect
                value={rule.approverGroupIds ?? []}
                readOnly
                isMulti
                className="w-full"
              />
            ) : (
              <p className="text-sm text-muted-foreground leading-relaxed">
                No groups assigned
              </p>
            )}
          </FieldItem>

          {/* Default Approver */}
          <FieldItem icon={LuUser} label="Default Approver">
            {rule.defaultApproverId ? (
              <EmployeeAvatar employeeId={rule.defaultApproverId} />
            ) : (
              <p className="text-sm text-muted-foreground leading-relaxed">
                Not set
              </p>
            )}
          </FieldItem>

          {/* Escalation Days */}
          {rule.escalationDays !== null &&
            rule.escalationDays !== undefined && (
              <FieldItem icon={LuCircleCheck} label="Escalation">
                <p className="text-sm font-semibold text-foreground leading-relaxed">
                  {rule.escalationDays}{" "}
                  {rule.escalationDays === 1 ? "day" : "days"}
                </p>
              </FieldItem>
            )}
        </div>

        {/* Metadata Section */}
        <div className="pt-6 border-t border-border w-full">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full">
            <FieldItem icon={LuUser} label="Created By">
              <EmployeeAvatar employeeId={rule.createdBy} />
            </FieldItem>

            {rule.createdAt && (
              <FieldItem icon={LuCalendar} label="Created At">
                <p className="text-sm text-foreground leading-relaxed">
                  {formatDate(rule.createdAt)}
                </p>
              </FieldItem>
            )}
          </div>
        </div>
      </VStack>
    );
  }
);

ApprovalRuleDetails.displayName = "ApprovalRuleDetails";
export default ApprovalRuleDetails;
