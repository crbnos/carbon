import { cn } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { LuChartLine } from "react-icons/lu";
import {
  UpgradeOverlay,
  UpgradeOverlayActions,
  UpgradeOverlayCard,
  UpgradeOverlayContent,
  UpgradeOverlayDescription,
  UpgradeOverlayIcon,
  UpgradeOverlayPreview,
  UpgradeOverlayTitle,
  UpgradeOverlayUpgradeButton
} from "~/components/UpgradeOverlay";

type ForecastUpgradeOverlayProps = {
  title: ReactNode;
  description: ReactNode;
};

// A lightweight faux chart so the blurred backdrop reads as "forecast" without
// depending on any loader data (the page still loads under the overlay).
const bars = [42, 68, 55, 80, 63, 74, 48, 90, 70, 58, 84, 66];

export default function ForecastUpgradeOverlay({
  title,
  description
}: ForecastUpgradeOverlayProps) {
  return (
    <UpgradeOverlay>
      <UpgradeOverlayPreview>
        <div className="flex h-full flex-col gap-4 p-6">
          <span className="text-lg font-semibold">{title}</span>
          <div className="flex flex-1 items-end gap-2 rounded-md border bg-muted/40 p-6">
            {bars.map((height, index) => (
              <div
                key={index}
                className={cn(
                  "flex-1 rounded-t-sm",
                  index % 2 === 0 ? "bg-primary/50" : "bg-primary/25"
                )}
                style={{ height: `${height}%` }}
              />
            ))}
          </div>
        </div>
      </UpgradeOverlayPreview>
      <UpgradeOverlayCard>
        <UpgradeOverlayIcon>
          <LuChartLine className="size-6 text-muted-foreground" />
        </UpgradeOverlayIcon>
        <UpgradeOverlayContent>
          <UpgradeOverlayTitle>{title}</UpgradeOverlayTitle>
          <UpgradeOverlayDescription>{description}</UpgradeOverlayDescription>
        </UpgradeOverlayContent>
        <UpgradeOverlayActions>
          <UpgradeOverlayUpgradeButton>
            <Trans>Upgrade to Business</Trans>
          </UpgradeOverlayUpgradeButton>
        </UpgradeOverlayActions>
      </UpgradeOverlayCard>
    </UpgradeOverlay>
  );
}
