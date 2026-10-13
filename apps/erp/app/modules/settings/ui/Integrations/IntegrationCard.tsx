// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Integration } from "@carbon/ee";
import { isIntegrationWhitelisted } from "@carbon/ee/plan";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  cn,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useRouteData
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuLock } from "react-icons/lu";
import { Link, useFetcher } from "react-router";
import { usePlanGate } from "~/hooks/usePlanGate";
import { path } from "~/utils/path";
import { InstallButton } from "./InstallButton";
import { InstallModeDialog } from "./InstallModeDialog";
import { startOAuthConnect } from "./useIntegrationInstall";

/** Mirrors `IntegrationHealthStatus` in settings.server (not importable here). */
type IntegrationHealthStatus =
  | "healthy"
  | "unhealthy"
  | "inactive"
  | "sync-off";

export type IntegrationHealth = {
  id: string;
  active: boolean;
  health: IntegrationHealthStatus;
  /** Why the last check failed, when the integration says. */
  healthReason?: string | null;
  /**
   * Which install mode this one is in, resolved SERVER-side.
   *
   * The id alone, not the metadata it came from — the card needs to pick copy,
   * not to see credentials.
   */
  installMode?: string;
};

export function IntegrationCard({
  integration,
  installed
}: {
  integration: Integration;
  installed: IntegrationHealth | null;
}) {
  const fetcher = useFetcher<{}>();
  // The declared mode this install is in, if any. Undefined for every
  // integration without modes, which then keeps its own description.
  const installedMode = installed?.installMode
    ? (
        integration as unknown as {
          modes?: Array<{
            id: string;
            description: string;
            shortDescription?: string;
          }>;
        }
      ).modes?.find((m) => m.id === installed.installMode)
    : undefined;
  const routeData = useRouteData<{
    activeRoles: Record<string, string | null>;
  }>(path.to.integrations);
  const [showModeDialog, setShowModeDialog] = useState(false);
  const { isGated } = usePlanGate({ feature: "INTEGRATIONS" });
  const isWhitelisted = isIntegrationWhitelisted(integration.id);
  const isStarterPlan = isGated && !isWhitelisted;

  // At most one ACTIVE integration per provider role, enforced by a database
  // trigger. Surfacing it here is what keeps a customer from meeting that
  // refusal as a failed install — and it names the incumbent, so the next step
  // is obvious.
  const providerRole = (
    integration as { providerRole?: "accounting" | "spend" }
  ).providerRole;
  const roleIncumbent = providerRole
    ? (routeData?.activeRoles?.[providerRole] ?? null)
    : null;
  const modes =
    (
      integration as {
        modes?: Array<{ id: string; label: string; description: string }>;
      }
    ).modes ?? [];

  const conflictsWith =
    roleIncumbent && roleIncumbent !== integration.id ? roleIncumbent : null;

  // An OAuth integration declaring install MODES needs that question answered
  // before consent, because the mode decides which scopes are requested. Every
  // other install goes through the shared `InstallButton`.
  const needsModeChoice =
    "oauth" in integration && !!integration.oauth && modes.length > 0;

  const handleUninstall = async () => {
    await integration?.onClientUninstall?.();
  };

  return (
    <Card data-whitelisted={isGated && isWhitelisted ? "true" : undefined}>
      <div className="pt-6 px-6 h-16 flex items-center justify-between gap-6">
        <integration.logo className="h-10 w-auto" />
        {integration.active ? (
          installed ? (
            <Badge className="flex-shrink-0" variant="green">
              <Trans>Installed</Trans>
            </Badge>
          ) : null
        ) : (
          <Badge className="flex-shrink-0" variant="secondary">
            <Trans>Not Configured</Trans>
          </Badge>
        )}
      </div>
      <CardHeader className="pb-0">
        <div className="flex items-center space-x-2 pb-4">
          <CardTitle className="text-md font-medium leading-none p-0 m-0">
            {integration.name}
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground pb-4">
        {/* An installed integration describes the mode it is actually in. The
            generic description covers every mode at once, so it is wrong for
            each of them. */}
        {installedMode?.shortDescription ??
          installedMode?.description ??
          integration.description}
      </CardContent>
      <CardFooter className="flex flex-end flex-row-reverse gap-2">
        {isStarterPlan ? (
          <Button variant="secondary" leftIcon={<LuLock />} asChild>
            <Link to={path.to.billing}>
              <Trans>Upgrade</Trans>
            </Link>
          </Button>
        ) : (
          <>
            <Button
              isDisabled={!installed}
              variant="secondary"
              asChild={!!installed}
            >
              {!installed ? (
                <span>
                  <Trans>Details</Trans>
                </span>
              ) : (
                <Link to={integration.active ? integration.id : "#"}>
                  <Trans>Details</Trans>
                </Link>
              )}
            </Button>
            {installed ? (
              <fetcher.Form
                method="post"
                action={path.to.integrationDeactivate(integration.id)}
                onSubmit={handleUninstall}
              >
                <Button
                  variant="destructive"
                  type="submit"
                  isDisabled={fetcher.state !== "idle"}
                  isLoading={fetcher.state !== "idle"}
                >
                  <Trans>Uninstall</Trans>
                </Button>
              </fetcher.Form>
            ) : (
              <InstallButton
                integration={integration}
                isDisabled={!!conflictsWith}
                onInstall={
                  needsModeChoice ? () => setShowModeDialog(true) : undefined
                }
              />
            )}
          </>
        )}
        {conflictsWith && !installed && (
          <span className="text-xs text-muted-foreground mr-auto">
            <Trans>Uninstall {conflictsWith} first</Trans>
          </span>
        )}
        {installed && integration.active && (
          <StatusBadge
            status={installed.health}
            reason={installed.healthReason}
          />
        )}
      </CardFooter>
      {showModeDialog && (
        <InstallModeDialog
          integrationName={integration.name}
          modes={modes}
          onClose={() => setShowModeDialog(false)}
          onChoose={(mode) => startOAuthConnect(integration.id, mode)}
        />
      )}
    </Card>
  );
}

const StatusBadge = ({
  status,
  reason
}: {
  status: IntegrationHealthStatus;
  reason?: string | null;
}) => {
  const { t } = useLingui();

  const colors = {
    healthy: "bg-green-500",
    unhealthy: "bg-red-500",
    inactive: "bg-gray-400",
    "sync-off": "bg-orange-500"
  } as const;

  const badgeVariants = {
    healthy: "green",
    unhealthy: "red",
    inactive: "gray",
    "sync-off": "orange"
  } as const;

  const labels = {
    healthy: t`Healthy`,
    unhealthy: t`Unhealthy`,
    inactive: t`Inactive`,
    // Connected, but the accounting sync switch is off — a new connection
    // still being set up, or one switched off since.
    "sync-off": t`Sync Off`
  } as const;

  const ping = colors[status] || "text-gray-400";
  const badge = (
    <Badge
      variant={badgeVariants[status]}
      className="flex items-center mr-auto gap-x-2 py-0.5"
    >
      <span className="relative flex size-2">
        {/* Nothing is moving while sync is off, so the dot holds still. */}
        {status !== "sync-off" && (
          <span
            className={cn(
              "absolute inline-flex h-full w-full animate-ping rounded-full opacity-75",
              ping
            )}
          />
        )}
        <span
          className={cn("relative inline-flex size-2 rounded-full", ping)}
        />
      </span>
      {labels[status]}
    </Badge>
  );

  if (!reason) return badge;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{badge}</TooltipTrigger>
      <TooltipContent className="max-w-xs">{reason}</TooltipContent>
    </Tooltip>
  );
};
