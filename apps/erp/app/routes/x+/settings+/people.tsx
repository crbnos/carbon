import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Copy,
  Heading,
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
import { msg } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useCallback, useEffect, useState } from "react";

import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useFetcher, useLoaderData } from "react-router";
import {
  getCompanySettings,
  updateConsoleSetting,
  updateTimeCardSetting
} from "~/modules/settings";
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

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "settings"
  });

  const formData = await request.formData();
  const intent = formData.get("intent");
  const enabled = formData.get("enabled") === "true";

  if (intent === "timeCard") {
    const update = await updateTimeCardSetting(client, companyId, enabled);
    if (update.error) return { success: false, message: update.error.message };
    return { success: true, message: "Timecard settings updated" };
  }

  if (intent === "console") {
    const update = await updateConsoleSetting(
      client,
      companyId,
      enabled,
      userId
    );

    if (update.error) return { success: false, message: update.error.message };

    // Check if a PIN was auto-generated for the user
    if (enabled) {
      const userPin = await client
        .from("employee")
        .select("pin" as any)
        .eq("id", userId)
        .eq("companyId", companyId)
        .maybeSingle();

      const pin = (userPin.data as any)?.pin;
      if (pin) {
        return {
          success: true,
          message: "Console mode enabled",
          pin
        };
      }
    }

    return { success: true, message: "Console mode settings updated" };
  }

  return { success: false, message: "Unknown intent" };
}

export default function PeopleSettingsRoute() {
  const { companySettings } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [showPinModal, setShowPinModal] = useState(false);
  const [generatedPin, setGeneratedPin] = useState<string | null>(null);

  const isToggling = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data?.success === true) {
      if ((fetcher.data as any)?.pin) {
        setGeneratedPin((fetcher.data as any).pin);
        setShowPinModal(true);
      } else if (fetcher.data?.message) {
        toast.success(fetcher.data.message);
      }
    }

    if (fetcher.data?.success === false && fetcher?.data?.message) {
      toast.error(fetcher.data.message);
    }
  }, [fetcher.data]);

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
      <VStack
        spacing={4}
        className="py-12 px-4 max-w-[60rem] h-full mx-auto gap-4"
      >
        <Heading size="h3">
          <Trans>People</Trans>
        </Heading>

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
                <HStack className="items-center gap-2">
                  <span className="font-medium">
                    {(companySettings as any).consoleEnabled ? (
                      <Trans>Console mode is enabled</Trans>
                    ) : (
                      <Trans>Console mode is disabled</Trans>
                    )}
                  </span>
                  <Badge variant="yellow">
                    <Trans>Beta</Trans>
                  </Badge>
                </HStack>

                <span className="text-sm text-muted-foreground">
                  {(companySettings as any).consoleEnabled ? (
                    <Trans>
                      Operators can use shared workstations with PIN
                      authentication.
                    </Trans>
                  ) : (
                    <Trans>Enable to allow shared workstation mode.</Trans>
                  )}
                </span>
              </VStack>
              <Switch
                checked={(companySettings as any).consoleEnabled ?? false}
                onCheckedChange={handleConsoleToggle}
                disabled={isToggling}
              />
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
                <HStack className="items-center gap-2">
                  <span className="font-medium">
                    {companySettings.timeCardEnabled ? (
                      <Trans>Timecards are enabled</Trans>
                    ) : (
                      <Trans>Timecards are disabled</Trans>
                    )}
                  </span>
                  <Badge variant="yellow">
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
      </VStack>

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
                    Remember this PIN. You will need it to exit console mode on
                    MES terminals.
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
