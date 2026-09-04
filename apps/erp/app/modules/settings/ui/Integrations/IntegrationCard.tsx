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
  cn
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { LuLock } from "react-icons/lu";
import { Link, useFetcher } from "react-router";
import { usePlanGate } from "~/hooks/usePlanGate";
import { path } from "~/utils/path";
import { InstallButton } from "./InstallButton";

export type IntegrationHealth = {
  id: string;
  active: boolean;
  health: "healthy" | "unhealthy" | "inactive";
};

export function IntegrationCard({
  integration,
  installed
}: {
  integration: Integration;
  installed: IntegrationHealth | null;
}) {
  const fetcher = useFetcher<{}>();
  const { isGated } = usePlanGate({ feature: "INTEGRATIONS" });
  const isWhitelisted = isIntegrationWhitelisted(integration.id);
  const isStarterPlan = isGated && !isWhitelisted;

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
            <Trans>Coming soon</Trans>
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
        {integration.description}
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
              <InstallButton integration={integration} />
            )}
          </>
        )}
        {installed && integration.active && (
          <StatusBadge status={installed.health} />
        )}
      </CardFooter>
    </Card>
  );
}

const StatusBadge = ({
  status
}: {
  status: "healthy" | "unhealthy" | "inactive";
}) => {
  const colors = {
    healthy: "bg-green-500",
    unhealthy: "bg-red-500",
    inactive: "bg-gray-400"
  } as const;

  const badgeVariants = {
    healthy: "green",
    unhealthy: "red",
    inactive: "gray"
  } as const;

  const ping = colors[status] || "text-gray-400";
  return (
    <Badge
      variant={badgeVariants[status]}
      className="flex items-center mr-auto gap-x-2 py-0.5"
    >
      <span className="relative flex size-2">
        <span
          className={cn(
            "absolute inline-flex h-full w-full animate-ping rounded-full opacity-75",
            ping
          )}
        />
        <span
          className={cn("relative inline-flex size-2 rounded-full", ping)}
        />
      </span>
      {status}
    </Badge>
  );
};
