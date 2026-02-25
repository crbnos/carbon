import {
  Button,
  CardAction,
  DropdownMenuIcon,
  DropdownMenuItem,
  useDisclosure
} from "@carbon/react";
import { usePlan } from "@carbon/remix";
import { Plan } from "@carbon/utils";
import { Suspense } from "react";
import { LuHistory } from "react-icons/lu";
import { Await } from "react-router";
import { useRouteData } from "~/hooks";
import { useFlags } from "~/hooks/useFlags";
import { path } from "~/utils/path";
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

  const rootRouteData = useRouteData<{
    auditLogEnabled: Promise<boolean>;
  }>(path.to.authenticatedRoot);

  const isStarterTeaser = isCloud && plan === Plan.Starter;

  const trigger = (
    <AuditLogTrigger
      variant={variant}
      onOpen={disclosure.onOpen}
      auditLogEnabledPromise={rootRouteData?.auditLogEnabled}
      isStarterTeaser={isStarterTeaser}
    />
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

// -- Internal components --

type AuditLogTriggerProps = {
  variant: "dropdown" | "card-action";
  onOpen: () => void;
  auditLogEnabledPromise: Promise<boolean> | undefined;
  isStarterTeaser: boolean;
};

function AuditLogTrigger({
  variant,
  onOpen,
  auditLogEnabledPromise,
  isStarterTeaser
}: AuditLogTriggerProps) {
  return (
    <Suspense fallback={null}>
      <Await resolve={auditLogEnabledPromise}>
        {(auditLogEnabled) => {
          if (!auditLogEnabled && !isStarterTeaser) return null;

          if (variant === "dropdown") {
            return (
              <DropdownMenuItem onClick={onOpen}>
                <DropdownMenuIcon icon={<LuHistory />} />
                History
              </DropdownMenuItem>
            );
          }

          return (
            <CardAction>
              <Button
                variant="secondary"
                leftIcon={<LuHistory />}
                onClick={onOpen}
              >
                History
              </Button>
            </CardAction>
          );
        }}
      </Await>
    </Suspense>
  );
}
