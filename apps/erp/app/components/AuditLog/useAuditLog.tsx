import {
  Button,
  CardAction,
  DropdownMenuIcon,
  DropdownMenuItem,
  useDisclosure
} from "@carbon/react";
import { LuHistory } from "react-icons/lu";
import { usePlanGate } from "~/hooks/usePlanGate";
import AuditLogDrawer from "./AuditLogDrawer";

type UseAuditLogOptions = {
  entityType: string;
  entityId: string;
  companyId: string;
  variant: "dropdown" | "card-action";
  triggerLabel?: React.ReactNode;
  drawerTitle?: React.ReactNode;
};

/**
 * Hook that returns audit log trigger and drawer elements.
 *
 * Place `trigger` inside the dropdown menu (or card header).
 * Place `drawer` at the component root level (outside any dropdown).
 *
 * This separation is necessary because Radix DropdownMenuContent unmounts
 * its children when the menu closes — the drawer must live outside it.
 */
export function useAuditLog({
  entityType,
  entityId,
  companyId,
  variant,
  triggerLabel = "History",
  drawerTitle
}: UseAuditLogOptions) {
  const disclosure = useDisclosure();
  const { isGated } = usePlanGate({ feature: "AUDIT_LOG" });

  const trigger =
    variant === "dropdown" ? (
      <DropdownMenuItem onClick={disclosure.onOpen}>
        <DropdownMenuIcon icon={<LuHistory />} />
        {triggerLabel}
      </DropdownMenuItem>
    ) : (
      <CardAction>
        <Button
          variant="secondary"
          leftIcon={<LuHistory />}
          onClick={disclosure.onOpen}
        >
          {triggerLabel}
        </Button>
      </CardAction>
    );

  const drawer = (
    <AuditLogDrawer
      isOpen={disclosure.isOpen}
      onClose={disclosure.onClose}
      entityType={entityType}
      entityId={entityId}
      companyId={companyId}
      title={drawerTitle}
      planRestricted={isGated}
    />
  );

  return { trigger, drawer };
}
