// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { PickingListLine } from "@carbon/mes-core";
import { isPickingListLocked } from "@carbon/mes-core";
import { useLingui } from "@lingui/react/macro";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { ActionDock } from "~/components/ActionDock";
import type { SheetHandle } from "~/components/BottomSheet";
import { StatusBadge } from "~/components/StatusBadge";
import {
  Body,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Muted,
  Screen,
  Skeleton,
  WarningNote
} from "~/components/ui";
import { commandMessage } from "~/features/picking/commands";
import {
  groupLinesIntoKits,
  resolvedLineCount
} from "~/features/picking/logic";
import { PickingLineRow } from "~/features/picking/PickingLineRow";
import { PickingStatusBar } from "~/features/picking/PickingStatusBar";
import { PickQuantitySheet } from "~/features/picking/PickQuantitySheet";
import { PickTrackedSheet } from "~/features/picking/PickTrackedSheet";
import {
  useItemTracking,
  usePickingListQuery,
  usePickingListRealtime
} from "~/features/picking/usePickingQueries";

/**
 * One picking list: the kits to fill, the lines in each, and the one status
 * move the list currently offers.
 *
 * Two things here are deliberate and easy to "fix" wrongly.
 *
 * **A locked list keeps every control, disabled, with the reason.** Web MES
 * hides the status buttons on a Completed / Partial / Cancelled list; the
 * shop-floor rules say a locked control stays visible and explains itself. So
 * `locked` is threaded down to every row rather than used to drop the actions.
 *
 * **Nothing here navigates on a failure.** A refused pick, a blocked finish, a
 * list somebody else closed — all of them are a toast with the server's own
 * words and a screen that stays where it was. The only navigation on this
 * screen is the kitter's own Back.
 */
export default function PickingList() {
  const { t } = useLingui();
  const { listId } = useLocalSearchParams<{ listId: string }>();
  const id = listId ?? "";

  const query = usePickingListQuery(id);
  usePickingListRealtime(id);

  const [activeLine, setActiveLine] = useState<PickingListLine | null>(null);
  const shortSheet = useRef<SheetHandle>(null);
  const trackedSheet = useRef<SheetHandle>(null);

  const list = query.data?.pickingList;
  const lines = useMemo(() => list?.lines ?? [], [list]);
  const kits = useMemo(() => groupLinesIntoKits(lines), [lines]);

  // `itemTrackingType` is not in the detail payload — the web reads it from a
  // client-side item store this app does not have — so it is one PostgREST
  // lookup for every item on the list. Until it answers, a line is treated as
  // UNTRACKED, which is the safe direction: the quantity command refuses a
  // tracked line server-side ("this line is tracked") rather than posting a
  // movement with no genealogy, whereas offering the lot picker for an
  // untracked line would show an empty list the kitter cannot explain.
  const tracking = useItemTracking(
    id,
    useMemo(() => lines.map((line) => line.itemId), [lines])
  );
  const isTracked = (line: PickingListLine) => {
    const type = tracking.data?.[line.itemId];
    return type === "Serial" || type === "Batch";
  };

  const locked = isPickingListLocked(list?.status);
  const lockedReason = t`This list is ${
    list?.status ?? ""
  }. Completed lists are reopened from the ERP.`;

  if (query.isPending) {
    return (
      <Screen
        className="gap-4 py-4"
        title={t`Picking list`}
        onBack={router.back}
      >
        <Skeleton className="h-16" />
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </Screen>
    );
  }

  if (query.isError || !list) {
    return (
      <Screen
        className="gap-4 py-4"
        title={t`Picking list`}
        onBack={router.back}
      >
        <ErrorNote>
          {commandMessage(query.error, t`Could not open this picking list`)}
        </ErrorNote>
        <Button variant="secondary" onPress={() => query.refetch()}>
          {t`Try again`}
        </Button>
      </Screen>
    );
  }

  const resolved = resolvedLineCount(lines);

  return (
    <View className="flex-1 flex-row bg-background">
      <View className="flex-1">
        <Screen
          title={list.pickingListId ?? t`Picking list`}
          onBack={router.back}
          scroll
          className="gap-4 px-4 py-4"
        >
          <View className="flex-row items-center justify-between gap-3">
            <Body className="font-semibold">
              {t`${resolved} of ${lines.length} lines`}
            </Body>
            <StatusBadge entity="pickingList" status={list.status} />
          </View>

          {locked ? <WarningNote>{lockedReason}</WarningNote> : null}

          {lines.length === 0 ? (
            <EmptyState
              title={t`This list has no lines`}
              description={t`Nothing was generated for it. Check the job's materials in the ERP.`}
            />
          ) : (
            kits.map((kit) => (
              <Card key={kit.key} className="gap-3 p-0">
                {/* One card per job operation, because that is the physical
                    box: parts must not be mixed across operations. */}
                <View className="gap-1 px-4 pt-4">
                  <Body className="font-semibold">
                    {kit.jobReadableId ?? t`Unknown job`}
                    {kit.operationName ? ` · ${kit.operationName}` : ""}
                  </Body>
                  {kit.workCenterName ? (
                    <Muted className="text-sm">{kit.workCenterName}</Muted>
                  ) : null}
                  <Muted className="text-sm">
                    {t`${resolvedLineCount(kit.lines)} of ${
                      kit.lines.length
                    } lines`}
                  </Muted>
                </View>
                {kit.lines.map((line) => (
                  <PickingLineRow
                    key={line.id}
                    listId={id}
                    line={line}
                    isTracked={isTracked(line)}
                    locked={locked}
                    lockedReason={lockedReason}
                    onShort={() => {
                      setActiveLine(line);
                      shortSheet.current?.open();
                    }}
                    onScan={() => {
                      setActiveLine(line);
                      trackedSheet.current?.open();
                    }}
                  />
                ))}
              </Card>
            ))
          )}
        </Screen>
      </View>

      <ActionDock>
        <PickingStatusBar
          listId={id}
          status={list.status}
          lines={lines.length}
          resolved={resolved}
        />
      </ActionDock>

      <PickQuantitySheet
        ref={shortSheet}
        listId={id}
        line={activeLine}
        onClose={() => shortSheet.current?.close()}
      />
      <PickTrackedSheet
        ref={trackedSheet}
        listId={id}
        line={activeLine}
        onClose={() => trackedSheet.current?.close()}
      />
    </View>
  );
}
