// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import { useKeepAwake } from "expo-keep-awake";
import { router } from "expo-router";
import { Ellipsis, Pause, Play } from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { toast } from "sonner-native";
import { ActionDock } from "~/components/ActionDock";
import type { SheetHandle } from "~/components/BottomSheet";
import { HeroButton } from "~/components/HeroButton";
import { TabBar, type TabDef, TabPanel } from "~/components/Tabs";
import { Button, ErrorNote, Screen, Skeleton } from "~/components/ui";
import { useIsTablet } from "~/components/useIsTablet";
import { useThemeColors } from "~/components/useThemeColor";
import { ApiClientError } from "~/lib/api/errors";
import {
  commandMessage,
  useEndEvent,
  usePrintLabel,
  useStartEvent
} from "./commands";
import { DetailsTab } from "./DetailsTab";
import { FinishDialog } from "./FinishDialog";
import { InstructionsTab } from "./InstructionsTab";
import {
  availableWorkTypes,
  eventIdsFrom,
  openEvents as findOpenEvents,
  type OpenEvents,
  parseMaterials,
  parseSteps,
  WORK_TYPES,
  type WorkType
} from "./logic";
import { MaterialsTab } from "./MaterialsTab";
import { MoreActionsSheet } from "./MoreActionsSheet";
import { NotesTab } from "./NotesTab";
import { OperationHeader } from "./OperationHeader";
import { QualityIssueSheet } from "./QualityIssueSheet";
import { QuantitySheet, ReworkSheet, ScrapSheet } from "./ReportSheets";
import { useOperationQuery } from "./useOperationQuery";
import { WorkTypeToggle } from "./WorkTypeToggle";

type Tab = "details" | "instructions" | "materials" | "notes";

/**
 * The operation screen — the one an operator stands in front of for a shift.
 *
 * A component rather than a route body, because a tablet in landscape renders
 * it BESIDE the operations list instead of navigating to it. One copy means
 * the two layouts cannot drift on what Start does.
 *
 * Two things here are deliberate and easy to "fix" wrongly.
 *
 * The screen keeps the device awake (`useKeepAwake`). A tablet clamped to a
 * machine that sleeps mid-cut means an operator with greasy gloves waking a
 * screen to press Pause, and a timer that ran longer than the work did.
 *
 * Every failure stays here. The design rules say an operator action never
 * navigates them away, so a blocked work center, an unreleased job or a rule
 * that refuses a quantity is a toast with the server's own words — never a
 * redirect, and never a screen replaced by an error page.
 */
export function OperationDetailView({
  operationId,
  onBack
}: {
  operationId: string;
  /** Omitted in the tablet's two-pane layout, where there is nothing to go back to. */
  onBack?: () => void;
}) {
  const { t } = useLingui();
  const isTablet = useIsTablet();
  const colors = useThemeColors();
  useKeepAwake();

  // Null means "whichever unit the server auto-selects". It only becomes a
  // real id when a scrap mints a replacement serial, which the operator then
  // carries on with — see `onReplacementEntity` below.
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const query = useOperationQuery(operationId, selectedEntityId);
  const detail = query.data;

  const [tab, setTab] = useState<Tab>("details");
  const [workType, setWorkType] = useState<WorkType | null>(null);
  const [finishing, setFinishing] = useState(false);
  const quantitySheet = useRef<SheetHandle>(null);
  const scrapSheet = useRef<SheetHandle>(null);
  const reworkSheet = useRef<SheetHandle>(null);
  const moreSheet = useRef<SheetHandle>(null);
  const qualitySheet = useRef<SheetHandle>(null);

  const start = useStartEvent(operationId);
  const end = useEndEvent(operationId);
  const print = usePrintLabel();

  const types = useMemo(
    () =>
      detail ? availableWorkTypes(detail.operation) : (["Labor"] as const),
    [detail]
  );
  // Annotated rather than inferred: the no-detail branch is `{}`, and the
  // union of that with the real shape is not indexable by a WorkType.
  const open = useMemo<OpenEvents>(
    () => (detail ? findOpenEvents(detail.events) : {}),
    [detail]
  );

  // The selected type defaults to whatever is ALREADY running, so an operator
  // returning to the tablet sees Pause for the timer that is open rather than
  // Start for a second one they did not mean to begin.
  const activeType: WorkType =
    workType ?? WORK_TYPES.find((type) => open[type]) ?? types[0] ?? "Labor";
  const openEvent = open[activeType];
  const running = Boolean(openEvent);

  const blockedReason = (() => {
    if (!detail) return undefined;
    if (detail.batch) {
      return t`This operation runs as part of a batch. Use Carbon MES in a browser to report it.`;
    }
    const workCenter = detail.workCenter?.data;
    if (workCenter?.isBlocked) {
      return workCenter.blockingDispatchReadableId
        ? t`${workCenter.name} is blocked by maintenance ${workCenter.blockingDispatchReadableId}.`
        : t`${workCenter.name} is blocked for maintenance.`;
    }
    return undefined;
  })();
  const locked = Boolean(blockedReason);

  const toggle = async () => {
    if (!detail) return;
    try {
      if (openEvent) {
        await end.mutateAsync({ eventId: openEvent.id });
      } else {
        await start.mutateAsync({
          type: activeType,
          workCenterId: detail.operation.workCenterId ?? undefined,
          trackedEntityId: detail.trackedEntityId ?? undefined
        });
      }
    } catch (error) {
      toast.error(
        commandMessage(
          error,
          openEvent ? t`Could not pause` : t`Could not start`
        )
      );
    }
  };

  // An inspection operation has its own screen, and the operations endpoint
  // refuses to answer for one — it reports `details.view` instead, which is
  // what the web loader redirects on. Doing the same here means tapping an
  // inspection card lands on the inspection rather than on an error telling
  // the operator to go and find a browser.
  //
  // Above the early returns, with the other hooks: this component returns a
  // skeleton before it ever returns the screen, so a hook below them would be
  // called on some renders and not others.
  //
  // `replace`, not `push`: the operation screen was never a place they chose
  // to be, so Back must return to the board, not to this error.
  const wrongView =
    query.error instanceof ApiClientError
      ? (query.error.details as { view?: string } | undefined)?.view
      : undefined;
  useEffect(() => {
    if (wrongView === "inspection" && operationId) {
      router.replace(`/(app)/inspection/${operationId}`);
    }
  }, [wrongView, operationId]);

  if (query.isLoading) {
    return (
      <Screen className="gap-4 py-4" title={t`Operation`} onBack={onBack}>
        <Skeleton className="h-24" />
        <Skeleton className="h-12" />
        <Skeleton className="h-40" />
      </Screen>
    );
  }

  if (query.isError || !detail) {
    return (
      <Screen className="gap-4 py-4" title={t`Operation`} onBack={onBack}>
        <ErrorNote>
          {commandMessage(query.error, t`Could not open this operation`)}
        </ErrorNote>
        <Button variant="secondary" onPress={() => query.refetch()}>
          {t`Try again`}
        </Button>
      </Screen>
    );
  }

  // The counts are on the tab so an operator can see there are six materials
  // without opening the tab to find out — and an empty tab is distinguishable
  // from one they have not looked at yet.
  const materialCount = parseMaterials(detail.materials).materials.length;
  const stepCount = parseSteps(detail.procedure).steps.length;

  const tabs: TabDef<Tab>[] = [
    { value: "details", label: t`Details` },
    {
      value: "instructions",
      label: t`Instructions`,
      badge: stepCount ? String(stepCount) : undefined
    },
    {
      value: "materials",
      label: t`Materials`,
      badge: materialCount ? String(materialCount) : undefined
    },
    { value: "notes", label: t`Notes` }
  ];

  const eventIds = eventIdsFrom(open);

  return (
    /*
     * Row on a tablet, COLUMN on a phone.
     *
     * `ActionDock` already switches itself between a right-hand column and a
     * bottom bar — but this parent was `flex-row` unconditionally, so on a
     * phone the bar became a row SIBLING of the content, took the width it
     * wanted, and left the operation itself with none. The screen rendered as
     * a dock floating on an empty background.
     */
    <View
      className={`flex-1 bg-background ${isTablet ? "flex-row" : "flex-col"}`}
    >
      <View className="flex-1">
        <Screen
          title={detail.job.jobId ?? t`Operation`}
          onBack={onBack}
          className="px-0"
        >
          <View className="px-4">
            <OperationHeader detail={detail} blockedReason={blockedReason} />
          </View>
          <TabBar tabs={tabs} value={tab} onChange={setTab} />
          <TabPanel active={tab === "details"}>
            <DetailsTab detail={detail} openEvents={open} />
          </TabPanel>
          <TabPanel active={tab === "instructions"}>
            <InstructionsTab detail={detail} />
          </TabPanel>
          <TabPanel active={tab === "materials"}>
            <MaterialsTab detail={detail} />
          </TabPanel>
          <TabPanel active={tab === "notes"}>
            <NotesTab detail={detail} />
          </TabPanel>
        </Screen>
      </View>

      <ActionDock
        // The work type is set once a shift, not once a unit, and it is the
        // one full-width control here — on a phone it cost the dock a whole
        // second row and the operator a quarter of the screen. Start, Log
        // completed and More stay on the bar.
        drawer={
          <WorkTypeToggle
            types={[...types]}
            value={activeType}
            open={open}
            onChange={setWorkType}
          />
        }
      >
        <HeroButton
          icon={running ? Pause : Play}
          label={running ? t`Pause` : t`Start`}
          tone={running ? "stop" : "start"}
          onPress={toggle}
          disabled={locked}
          loading={start.isPending || end.isPending}
          disabledReason={blockedReason}
        />
        <Button
          variant="secondary"
          onPress={() => quantitySheet.current?.open()}
          disabled={locked}
          // 56pt on a phone so the row's three controls share one height.
          className={isTablet ? undefined : "min-h-[56px] rounded-xl px-4"}
        >
          {t`Log completed`}
        </Button>
        {isTablet ? (
          <Button
            variant="ghost"
            onPress={() => moreSheet.current?.open()}
            accessibilityLabel={t`More actions`}
          >
            {t`More`}
          </Button>
        ) : (
          // The word costs a third of a phone's row and says less than the
          // glyph: three dots is what "more actions" looks like everywhere
          // else on the device.
          <Pressable
            onPress={() => moreSheet.current?.open()}
            accessibilityRole="button"
            accessibilityLabel={t`More actions`}
            className="size-14 items-center justify-center rounded-xl border border-border bg-secondary active:opacity-70"
          >
            <Ellipsis size={24} color={colors.foreground} />
          </Pressable>
        )}
      </ActionDock>

      <QuantitySheet
        ref={quantitySheet}
        detail={detail}
        eventIds={eventIds}
        onClose={() => quantitySheet.current?.close()}
      />
      <ScrapSheet
        ref={scrapSheet}
        detail={detail}
        eventIds={eventIds}
        onClose={() => scrapSheet.current?.close()}
        onReplacementEntity={setSelectedEntityId}
      />
      <ReworkSheet
        ref={reworkSheet}
        detail={detail}
        eventIds={eventIds}
        onClose={() => reworkSheet.current?.close()}
      />
      <MoreActionsSheet
        ref={moreSheet}
        disabledReason={blockedReason}
        printing={print.isPending}
        onQualityIssue={() => {
          moreSheet.current?.close();
          qualitySheet.current?.open();
        }}
        onPrint={async () => {
          moreSheet.current?.close();
          try {
            // "Operation" + the operation id is the product-label pair in
            // `@carbon/printing`'s own document registry. Nothing prints from
            // the device: the server already knows the printers, and mobile
            // operating systems make raw network printing hard.
            await print.mutateAsync({
              sourceDocument: "Operation",
              sourceDocumentId: operationId,
              workCenterId: detail.operation.workCenterId ?? undefined
            });
            toast.success(t`Sent to the printer`);
          } catch (error) {
            toast.error(commandMessage(error, t`Could not print that label`));
          }
        }}
        onScrap={() => {
          moreSheet.current?.close();
          scrapSheet.current?.open();
        }}
        onRework={() => {
          moreSheet.current?.close();
          reworkSheet.current?.open();
        }}
        onFinish={() => {
          moreSheet.current?.close();
          setFinishing(true);
        }}
      />
      <QualityIssueSheet
        ref={qualitySheet}
        detail={detail}
        onClose={() => qualitySheet.current?.close()}
      />
      <FinishDialog
        open={finishing}
        detail={detail}
        openEvents={open}
        onClose={() => setFinishing(false)}
      />
    </View>
  );
}
