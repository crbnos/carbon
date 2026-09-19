// Plan-gate overlay shell shared by the two rule families (Inventory → Storage
// Rules, Sales → Sales Rules). The families differ only in their preview table,
// their mock fixtures, and their copy — the overlay chrome is identical, so it
// lives here once. A third family gets the overlay for free.

import type { ReactNode } from "react";
import { LuShieldCheck } from "react-icons/lu";
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

type RulesUpgradeOverlayProps = {
  /** Blurred table rendered behind the upgrade card. */
  preview: ReactNode;
  /** Feature name — already wrapped in `<Trans>` by the caller. */
  title: ReactNode;
  /** One-sentence pitch — already wrapped in `<Trans>` by the caller. */
  description: ReactNode;
};

export default function RulesUpgradeOverlay({
  preview,
  title,
  description
}: RulesUpgradeOverlayProps) {
  return (
    <UpgradeOverlay>
      <UpgradeOverlayPreview>{preview}</UpgradeOverlayPreview>
      <UpgradeOverlayCard>
        <UpgradeOverlayIcon>
          <LuShieldCheck className="size-6 text-muted-foreground" />
        </UpgradeOverlayIcon>
        <UpgradeOverlayContent>
          <UpgradeOverlayTitle>{title}</UpgradeOverlayTitle>
          <UpgradeOverlayDescription>{description}</UpgradeOverlayDescription>
        </UpgradeOverlayContent>
        <UpgradeOverlayActions>
          <UpgradeOverlayUpgradeButton />
        </UpgradeOverlayActions>
      </UpgradeOverlayCard>
    </UpgradeOverlay>
  );
}
