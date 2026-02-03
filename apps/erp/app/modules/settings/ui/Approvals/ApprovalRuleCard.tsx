import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Card,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Heading,
  HStack,
  IconButton,
  Status,
  useDisclosure
} from "@carbon/react";
import { memo, useCallback } from "react";
import { LuEllipsisVertical, LuPencil, LuTrash } from "react-icons/lu";
import { useNavigate } from "react-router";
import ConfirmDelete from "~/components/Modals/ConfirmDelete";
import { useCurrencyFormatter, usePermissions, useUrlParams } from "~/hooks";
import {
  type ApprovalDocumentType,
  type ApprovalRule,
  approvalDocumentTypeLabel,
  approvalDocumentTypesWithAmounts
} from "~/modules/shared";
import { path } from "~/utils/path";
import ApprovalRuleDetails from "./ApprovalRuleDetails";

type ApprovalRuleCardProps = {
  rule: ApprovalRule & { approverGroupNames?: string[] };
  documentType: ApprovalDocumentType;
};

const ApprovalRuleCard = memo(
  ({ rule, documentType }: ApprovalRuleCardProps) => {
    const [params] = useUrlParams();
    const navigate = useNavigate();
    const permissions = usePermissions();
    const currencyFormatter = useCurrencyFormatter({
      notation: "compact", // short/compact form
      compactDisplay: "short" // "short" → 1.2M, "long" → 1.2 million
    });
    const deleteDisclosure = useDisclosure();

    const canEdit = permissions.can("update", "settings");
    const canDelete = permissions.can("update", "settings");

    const handleEdit = useCallback(() => {
      if (!rule.id) return;
      navigate(`${path.to.approvalRule(rule.id)}?${params.toString()}`);
    }, [navigate, params, rule.id]);

    const handleDeleteClick = useCallback(() => {
      deleteDisclosure.onOpen();
    }, [deleteDisclosure]);

    const handleDeleteConfirm = useCallback(() => {
      deleteDisclosure.onClose();
    }, [deleteDisclosure]);

    if (!rule.id) return null;

    return (
      <>
        <Card className="p-0 border">
          <Accordion type="multiple" className="w-full">
            <AccordionItem value={rule.id} className="border-none">
              <div className="relative">
                <AccordionTrigger className="px-6 py-8 hover:no-underline w-full">
                  <HStack spacing={4} className="flex-1 justify-between pr-12">
                    <Heading size="h4" as="h3">
                      {approvalDocumentTypeLabel[documentType]}
                      {approvalDocumentTypesWithAmounts.includes(
                        documentType
                      ) &&
                        ` over ${currencyFormatter.format(rule.lowerBoundAmount ?? 0)}`}
                    </Heading>
                    <Status
                      color={rule.enabled ? "green" : "gray"}
                      className="text-xs font-medium"
                    >
                      {rule.enabled ? "Enabled" : "Disabled"}
                    </Status>
                  </HStack>
                </AccordionTrigger>
                <div className="absolute right-12 top-1/2 -translate-y-1/2 z-10">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <IconButton
                        aria-label="More options"
                        icon={<LuEllipsisVertical />}
                        variant="ghost"
                        onClick={(e) => e.stopPropagation()}
                      />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        disabled={!canEdit}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEdit();
                        }}
                      >
                        <LuPencil className="mr-2 h-4 w-4" />
                        Edit Rule
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        destructive
                        disabled={!canDelete}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteClick();
                        }}
                      >
                        <LuTrash className="mr-2 h-4 w-4" />
                        Delete Rule
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
              <AccordionContent className="px-6 pb-5">
                <ApprovalRuleDetails
                  rule={rule}
                  documentType={documentType}
                  currencyFormatter={currencyFormatter}
                />
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </Card>
        <ConfirmDelete
          action={path.to.deleteApprovalRule(rule.id)}
          isOpen={deleteDisclosure.isOpen}
          name={`${documentType === "purchaseOrder" ? "Purchase Order" : "Quality Document"} approval rule`}
          text={`Are you sure you want to delete this approval rule? This cannot be undone.`}
          onCancel={deleteDisclosure.onClose}
          onSubmit={handleDeleteConfirm}
        />
      </>
    );
  }
);

ApprovalRuleCard.displayName = "ApprovalRuleCard";
export default ApprovalRuleCard;
