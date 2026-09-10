import { Trans } from "@lingui/react/macro";
import { LuShieldCheck } from "react-icons/lu";
import {
  UpgradeOverlayActions,
  UpgradeOverlayContent,
  UpgradeOverlayDescription,
  UpgradeOverlayDialog,
  UpgradeOverlayIcon,
  UpgradeOverlayTitle,
  UpgradeOverlayUpgradeButton
} from "~/components/UpgradeOverlay";

export default function TwoFactorUpgradeDialog({
  open,
  onOpenChange
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <UpgradeOverlayDialog open={open} onOpenChange={onOpenChange}>
      <UpgradeOverlayIcon>
        <LuShieldCheck className="size-6 text-muted-foreground" />
      </UpgradeOverlayIcon>
      <UpgradeOverlayContent>
        <UpgradeOverlayTitle>
          <Trans>Two-Factor Authentication</Trans>
        </UpgradeOverlayTitle>
        <UpgradeOverlayDescription>
          <Trans>
            Add an extra layer of security by requiring a code from an
            authenticator app when signing in.
          </Trans>
        </UpgradeOverlayDescription>
      </UpgradeOverlayContent>
      <UpgradeOverlayActions>
        <UpgradeOverlayUpgradeButton />
      </UpgradeOverlayActions>
    </UpgradeOverlayDialog>
  );
}
