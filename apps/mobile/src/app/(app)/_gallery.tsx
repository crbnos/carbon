// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Trans, useLingui } from "@lingui/react/macro";
import { Redirect } from "expo-router";
import {
  CircleCheck,
  Pause,
  Play,
  Printer,
  RotateCcw,
  Trash2
} from "lucide-react-native";
import { useRef, useState } from "react";
import { View } from "react-native";
import { ActionDock } from "~/components/ActionDock";
import { BigNumber } from "~/components/BigNumber";
import { Sheet, type SheetHandle, SheetRow } from "~/components/BottomSheet";
import { ConfirmDialog } from "~/components/ConfirmDialog";
import { HeroButton } from "~/components/HeroButton";
import { StatusBadge } from "~/components/StatusBadge";
import {
  Body,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  Heading,
  Muted,
  Screen,
  Skeleton,
  WarningNote
} from "~/components/ui";
import { useIsTablet } from "~/components/useIsTablet";

/**
 * Every primitive on one screen, so each can be checked on a real device:
 * light and dark, both dock shapes, and every target measured against the 44pt
 * floor with the Expo element inspector.
 *
 * It is reachable only from the More screen's dev section, which is
 * `__DEV__`-gated — but that gate hides the BUTTON, not the route. Expo Router
 * special-cases only `_layout`, so a leading underscore does NOT keep a file
 * out of the route tree: `/_gallery` is a real path in a production bundle, and
 * the generated router types list it. Hence the redirect below, which is what
 * actually keeps a dev screen out of a store build.
 *
 * It outlives Phase 3 on purpose, against the plan's own note to delete it: it
 * IS the Task 34 and Task 51 device check — every primitive in both themes and
 * both dock shapes — and that pass has not happened yet. Delete it once it has.
 */
/** These controls exist to be looked at and pressed, not to do anything. */
const noop = () => undefined;

export default function Gallery() {
  // Before any hook, so a production build cannot render a frame of this.
  if (!__DEV__) return <Redirect href="/(app)/(tabs)/operations" />;
  return <GalleryScreen />;
}

function GalleryScreen() {
  const { t } = useLingui();
  const isTablet = useIsTablet();
  const sheet = useRef<SheetHandle>(null);
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);

  return (
    <View className="flex-1 flex-row bg-background">
      <View className="flex-1">
        <Screen scroll title={t`Primitives`} className="gap-6 py-4">
          <Muted>
            {isTablet
              ? t`Tablet layout: the dock is the right-hand column.`
              : t`Phone layout: the dock is the bottom bar.`}
          </Muted>

          <View className="gap-3">
            <Heading>
              <Trans>Status</Trans>
            </Heading>
            <View className="flex-row flex-wrap gap-2">
              {[
                "Todo",
                "Ready",
                "Waiting",
                "In Progress",
                "Paused",
                "Done",
                "Canceled"
              ].map((status) => (
                <StatusBadge
                  key={status}
                  entity="jobOperation"
                  status={status}
                />
              ))}
            </View>
          </View>

          <View className="gap-3">
            <Heading>
              <Trans>Quantities</Trans>
            </Heading>
            <Card className="gap-3">
              <BigNumber value={12} of={40} />
              <BigNumber value={0.00125} of={2} />
              <BigNumber value={7} suffix={t`scrapped`} />
            </Card>
          </View>

          <View className="gap-3">
            <Heading>
              <Trans>Buttons</Trans>
            </Heading>
            <View className="flex-row flex-wrap gap-3">
              <Button onPress={noop}>{t`Primary`}</Button>
              <Button variant="secondary" onPress={noop}>
                {t`Secondary`}
              </Button>
              <Button variant="destructive" onPress={noop}>
                {t`Destructive`}
              </Button>
              <Button loading onPress={noop}>
                {t`Loading`}
              </Button>
              <Button disabled onPress={noop}>
                {t`Disabled`}
              </Button>
            </View>
            <Field label={t`A field`} placeholder={t`48pt minimum`} />
          </View>

          <View className="gap-3">
            <Heading>
              <Trans>States</Trans>
            </Heading>
            <Skeleton className="h-20" />
            <ErrorNote>{t`Something the operator must read.`}</ErrorNote>
            <WarningNote>{t`Something that limits what they can do here.`}</WarningNote>
            <Card>
              <EmptyState
                title={t`Nothing to show`}
                description={t`Only when it is truly empty — never while loading.`}
              />
            </Card>
          </View>

          <View className="gap-3">
            <Heading>
              <Trans>Sheet and confirmation</Trans>
            </Heading>
            <Button variant="secondary" onPress={() => sheet.current?.open()}>
              {t`Open the sheet`}
            </Button>
            <Button variant="secondary" onPress={() => setConfirming(true)}>
              {t`Open a confirmation`}
            </Button>
          </View>

          <Body className="pb-4 text-sm text-muted-foreground">
            {t`Rotate the device to swap the dock between a column and a bar.`}
          </Body>
        </Screen>
      </View>

      <ActionDock>
        <HeroButton
          icon={running ? Pause : Play}
          label={running ? t`Pause` : t`Start`}
          tone={running ? "stop" : "start"}
          onPress={() => setRunning((was) => !was)}
        />
        <Button variant="secondary" onPress={noop}>
          {t`Log Completed`}
        </Button>
        <Button variant="ghost" onPress={() => sheet.current?.open()}>
          {t`More actions`}
        </Button>
      </ActionDock>

      <Sheet ref={sheet} title={t`More actions`}>
        <SheetRow
          icon={Trash2}
          label={t`Report scrap`}
          tone="destructive"
          onPress={() => sheet.current?.close()}
        />
        <SheetRow
          icon={RotateCcw}
          label={t`Report rework`}
          onPress={() => sheet.current?.close()}
        />
        <SheetRow
          icon={CircleCheck}
          label={t`Finish operation`}
          onPress={() => sheet.current?.close()}
        />
        <SheetRow
          icon={Printer}
          label={t`Maintenance request`}
          onPress={noop}
          disabled
          disabledReason={t`Use Carbon MES in a browser for this.`}
        />
      </Sheet>

      <ConfirmDialog
        open={confirming}
        title={t`Finish this operation?`}
        description={t`Open timers will be closed.`}
        affected={[t`Setup — 00:14:02`, t`Labor — 01:22:40`]}
        confirmLabel={t`Finish`}
        cancelLabel={t`Cancel`}
        onConfirm={() => setConfirming(false)}
        onCancel={() => setConfirming(false)}
      />
    </View>
  );
}
