// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { useAction } from "@carbon/query";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Copy,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  ScrollArea,
  Switch,
  toast,
  VStack
} from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { z } from "zod";
import { SettingsPage, SettingsPageHeading } from "~/components/SettingsPage";
import { UpgradeOverlayUpgradeButton } from "~/components/UpgradeOverlay";
import { usePlanGate } from "~/hooks/usePlanGate";
import { settingsToggle } from "~/modules/settings/settings.models";
import { getCompanySettings } from "~/modules/settings/settings.service";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`People`,
  to: path.to.peopleSettings
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "settings"
  });

  const companySettings = await getCompanySettings(client, companyId);

  if (!companySettings.data)
    throw redirect(
      path.to.settings,
      await flash(
        request,
        error(companySettings.error, "Failed to get company settings")
      )
    );
  return { companySettings: companySettings.data };
}

// One switch per setting, told apart by its intent.
const peopleSettingsForm = z.discriminatedUnion("intent", [
  settingsToggle("timeCard", "timeCardEnabled"),
  settingsToggle("console", "consoleEnabled")
]);

export async function action(args: ActionFunctionArgs) {
  const input = await validator(peopleSettingsForm).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  return api.settings.updatePeopleSettings(input.data);
}

export default function PeopleSettingsRoute() {
  const { companySettings } = useLoaderData<typeof loader>();
  const { t } = useLingui();
  // Enterprise: console (kiosk) mode is gated to the Business plan.
  const { isGated: consoleGated } = usePlanGate({ feature: "PERMISSIONS" });
  const [showPinModal, setShowPinModal] = useState(false);
  const [generatedPin, setGeneratedPin] = useState<string | null>(null);
  const fetcher = useAction<typeof action>({
    onSuccess: ({ data }) => {
      if (!data) return;
      if (data.pin) {
        // Shown once: the PIN is stored hashed and can never be read back.
        setGeneratedPin(data.pin);
        setShowPinModal(true);
      } else if (data.pinError) {
        toast.error(
          t`Console mode enabled, but ${data.pinError.toLowerCase()}. Set one from Users → Employees → Set Console PIN.`
        );
      } else if (data.consoleEnabled !== undefined) {
        toast.success(t`Console mode settings updated`);
      } else {
        toast.success(t`Timecard settings updated`);
      }
    }
  });

  const isToggling = fetcher.state !== "idle";

  const handleConsoleToggle = useCallback(
    (checked: boolean) => {
      fetcher.submit(
        { intent: "console", enabled: String(checked) },
        { method: "POST" }
      );
    },
    [fetcher]
  );

  const handleTimeCardToggle = useCallback(
    (checked: boolean) => {
      fetcher.submit(
        { intent: "timeCard", enabled: String(checked) },
        { method: "POST" }
      );
    },
    [fetcher]
  );

  return (
    <ScrollArea className="w-full h-[calc(100dvh-var(--topbar-height)-var(--content-inset))]">
      <SettingsPage className="gap-4">
        <SettingsPageHeading>
          <Trans>People</Trans>
        </SettingsPageHeading>

        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Console Mode</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>
                Enable shared workstation mode for MES terminals. Operators
                identify themselves via PIN before performing work.
              </Trans>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <HStack className="justify-between items-center">
              <VStack className="items-start" spacing={1}>
                <HStack className="items-center gap-2 max-md:flex-wrap">
                  <span className="font-medium">
                    {(companySettings as any).consoleEnabled ? (
                      <Trans>Console mode is enabled</Trans>
                    ) : (
                      <Trans>Console mode is disabled</Trans>
                    )}
                  </span>
                  <Badge variant="yellow" className="max-md:shrink-0">
                    <Trans>Beta</Trans>
                  </Badge>
                </HStack>

                <span className="text-sm text-muted-foreground">
                  {consoleGated ? (
                    <Trans>Available on the Business plan</Trans>
                  ) : (companySettings as any).consoleEnabled ? (
                    <Trans>
                      Operators can use shared workstations with PIN
                      authentication.
                    </Trans>
                  ) : (
                    <Trans>Enable to allow shared workstation mode.</Trans>
                  )}
                </span>
              </VStack>
              {consoleGated ? (
                <UpgradeOverlayUpgradeButton />
              ) : (
                <Switch
                  checked={(companySettings as any).consoleEnabled ?? false}
                  onCheckedChange={handleConsoleToggle}
                  disabled={isToggling}
                />
              )}
            </HStack>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Timecards</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>Enable timecard tracking for work shifts.</Trans>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <HStack className="justify-between items-center">
              <VStack className="items-start" spacing={1}>
                <HStack className="items-center gap-2 max-md:flex-wrap">
                  <span className="font-medium">
                    {companySettings.timeCardEnabled ? (
                      <Trans>Timecards are enabled</Trans>
                    ) : (
                      <Trans>Timecards are disabled</Trans>
                    )}
                  </span>
                  <Badge variant="yellow" className="max-md:shrink-0">
                    <Trans>Beta</Trans>
                  </Badge>
                </HStack>

                <span className="text-sm text-muted-foreground">
                  {companySettings.timeCardEnabled ? (
                    <Trans>Work shift tracking is active.</Trans>
                  ) : (
                    <Trans>Enable to start tracking work shifts.</Trans>
                  )}
                </span>
              </VStack>
              <Switch
                checked={companySettings.timeCardEnabled ?? false}
                onCheckedChange={handleTimeCardToggle}
                disabled={isToggling}
              />
            </HStack>
          </CardContent>
        </Card>
      </SettingsPage>

      {showPinModal && generatedPin && (
        <Modal open onOpenChange={(open) => !open && setShowPinModal(false)}>
          <ModalOverlay />
          <ModalContent>
            <ModalHeader>
              <ModalTitle>
                <Trans>Your Console PIN</Trans>
              </ModalTitle>
            </ModalHeader>
            <ModalBody>
              <VStack spacing={4}>
                <p className="text-sm text-muted-foreground">
                  <Trans>
                    Console mode has been enabled. Use this PIN to identify
                    yourself at MES terminals.
                  </Trans>
                </p>
                <div className="flex items-center justify-center gap-3">
                  <span className="font-mono text-3xl tracking-[0.4em]">
                    {generatedPin}
                  </span>
                  <Copy text={generatedPin} />
                </div>
                <p className="text-xs text-muted-foreground text-center">
                  <Trans>
                    This PIN will not be shown again. You will need it to exit
                    console mode on MES terminals.
                  </Trans>
                </p>
              </VStack>
            </ModalBody>
            <ModalFooter>
              <HStack>
                <Button onClick={() => setShowPinModal(false)}>
                  <Trans>Done</Trans>
                </Button>
              </HStack>
            </ModalFooter>
          </ModalContent>
        </Modal>
      )}
    </ScrollArea>
  );
}
