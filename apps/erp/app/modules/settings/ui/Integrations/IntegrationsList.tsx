import type { Integration, QuickInstallConnector } from "@carbon/ee";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useUrlParams
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo, useRef, useState } from "react";
import { LuPuzzle } from "react-icons/lu";
import { SearchFilter } from "~/components";
import {
  UpgradeOverlayActions,
  UpgradeOverlayContent,
  UpgradeOverlayDescription,
  UpgradeOverlayIcon,
  UpgradeOverlayStickyGradient,
  UpgradeOverlayTitle,
  UpgradeOverlayUpgradeButton
} from "~/components/UpgradeOverlay";
import { useAnyVisible } from "~/hooks/useAnyVisible";
import { usePlanGate } from "~/hooks/usePlanGate";
import type { IntegrationHealth } from "./IntegrationCard";
import { IntegrationCard } from "./IntegrationCard";
import { QuickInstall } from "./QuickInstall";

type IntegrationsListProps = {
  availableIntegrations: Integration[];
  integrations: Array<IntegrationHealth>;
  quickInstallConnectors?: QuickInstallConnector[];
};

const IntegrationsList = ({
  integrations,
  availableIntegrations,
  quickInstallConnectors = []
}: IntegrationsListProps) => {
  const { t } = useLingui();
  const [params] = useUrlParams();
  const [filter, setFilter] = useState<"all" | "installed" | "available">(
    "all"
  );
  const { isGated } = usePlanGate({ feature: "INTEGRATIONS" });
  const search = params.get("search") || "";

  const gridRef = useRef<HTMLDivElement>(null);

  const installed = integrations.filter((i) => i.id && i.active);
  const installedIds = installed.map((i) => i.id);

  const filteredIntegrations = useMemo(() => {
    let filtered = availableIntegrations;

    if (search) {
      filtered = filtered.filter((integration) =>
        integration.name.toLowerCase().includes(search.toLowerCase())
      );
    }

    if (filter === "installed") {
      filtered = filtered.filter((integration) =>
        installedIds.includes(integration.id)
      );
    } else if (filter === "available") {
      filtered = filtered.filter(
        (integration) =>
          !installedIds.includes(integration.id) && integration.active
      );
    }

    return filtered;
  }, [availableIntegrations, installedIds, search, filter]);

  const anyWhitelistedVisible = useAnyVisible({
    containerRef: gridRef,
    selector: '[data-whitelisted="true"]',
    enabled: isGated,
    deps: [filteredIntegrations]
  });
  const showOverlay = isGated && !anyWhitelistedVisible;

  return (
    <div className="flex flex-col gap-4">
      <QuickInstall connectors={quickInstallConnectors} />
      <div className="flex flex-row gap-2 pt-4 px-4">
        <div>
          <SearchFilter param="search" size="sm" placeholder={t`Search`} />
        </div>
        <div>
          <Select
            value={filter}
            onValueChange={(value) =>
              setFilter(value as "all" | "installed" | "available")
            }
          >
            <SelectTrigger size="sm">
              <SelectValue placeholder="Select a category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="installed">Installed</SelectItem>
              <SelectItem value="available">Available</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div
        ref={gridRef}
        className={`grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 px-4 w-full ${
          isGated ? "pb-64" : "pb-4"
        }`}
      >
        {filteredIntegrations.map((integration) => {
          return (
            <IntegrationCard
              key={integration.id}
              integration={integration}
              installed={installed.find((i) => i.id === integration.id) || null}
            />
          );
        })}
      </div>

      {isGated && (
        <>
          <UpgradeOverlayStickyGradient
            className={`transition-all duration-300 ease-out ${
              showOverlay
                ? "opacity-100 translate-y-0"
                : "opacity-0 translate-y-20 pointer-events-none"
            }`}
          >
            <UpgradeOverlayIcon>
              <LuPuzzle className="size-6 text-muted-foreground" />
            </UpgradeOverlayIcon>
            <UpgradeOverlayContent>
              <UpgradeOverlayTitle>
                <Trans>Integrations</Trans>
              </UpgradeOverlayTitle>
              <UpgradeOverlayDescription>
                <Trans>
                  Connect Carbon to your accounting, project management, and CAD
                  tools and much more.
                </Trans>
              </UpgradeOverlayDescription>
            </UpgradeOverlayContent>
            <UpgradeOverlayActions>
              <UpgradeOverlayUpgradeButton />
            </UpgradeOverlayActions>
          </UpgradeOverlayStickyGradient>
        </>
      )}
    </div>
  );
};

export default IntegrationsList;
