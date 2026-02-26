import {
  Button,
  CardAction,
  DropdownMenuIcon,
  DropdownMenuItem,
  useDisclosure
} from "@carbon/react";
import { usePlan } from "@carbon/remix";
import { Plan } from "@carbon/utils";
import { LuHistory } from "react-icons/lu";
import { useFlags } from "~/hooks/useFlags";
import AuditLogDrawer from "./AuditLogDrawer";

type UseAuditLogOptions = {
  entityType: string;
  entityId: string;
  companyId: string;
  variant: "dropdown" | "card-action";
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
  variant
}: UseAuditLogOptions) {
  const disclosure = useDisclosure();
  const plan = usePlan();
  const { isCloud } = useFlags();

  const isStarterTeaser = isCloud && plan === Plan.Starter;

  const trigger =
    variant === "dropdown" ? (
      <DropdownMenuItem onClick={disclosure.onOpen}>
        <DropdownMenuIcon icon={<LuHistory />} />
        History
      </DropdownMenuItem>
    ) : (
      <CardAction>
        <Button
          variant="secondary"
          leftIcon={<LuHistory />}
          onClick={disclosure.onOpen}
        >
          History
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
      planRestricted={isStarterTeaser}
    />
  );

  return { trigger, drawer };
}
