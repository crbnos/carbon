import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Heading,
  HStack,
  Switch,
  VStack
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
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

export default function SecurityUpgradeOverlay() {
  return (
    <UpgradeOverlay>
      <UpgradeOverlayPreview>
        <VStack spacing={4} className="py-12 px-4 max-w-[60rem] mx-auto gap-4">
          <Heading size="h3">Security</Heading>
          <Card>
            <CardHeader>
              <HStack className="justify-between items-center">
                <div>
                  <CardTitle>Two-Factor Authentication Enforcement</CardTitle>
                  <CardDescription>
                    Require an authenticator app before anyone can open this
                    company. Their other companies are unaffected.
                  </CardDescription>
                </div>
                <Switch checked={false} disabled />
              </HStack>
            </CardHeader>
          </Card>
        </VStack>
      </UpgradeOverlayPreview>
      <UpgradeOverlayCard>
        <UpgradeOverlayIcon>
          <LuShieldCheck className="size-6 text-muted-foreground" />
        </UpgradeOverlayIcon>
        <UpgradeOverlayContent>
          <UpgradeOverlayTitle>
            <Trans>Security</Trans>
          </UpgradeOverlayTitle>
          <UpgradeOverlayDescription>
            <Trans>
              Protect your company with advanced security controls like
              two-factor authentication enforcement.
            </Trans>
          </UpgradeOverlayDescription>
        </UpgradeOverlayContent>
        <UpgradeOverlayActions>
          <UpgradeOverlayUpgradeButton />
        </UpgradeOverlayActions>
      </UpgradeOverlayCard>
    </UpgradeOverlay>
  );
}
