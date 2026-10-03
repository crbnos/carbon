// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { InspectionDecision } from "@carbon/mes-core/models";
import { useLingui } from "@lingui/react/macro";
import { Check, ChevronRight } from "lucide-react-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Sheet, type SheetHandle } from "~/components/BottomSheet";
import {
  Body,
  Button,
  ErrorNote,
  Field,
  Muted,
  Skeleton,
  WarningNote
} from "~/components/ui";
import { useThemeColors } from "~/components/useThemeColor";
import { parseQuantity } from "~/features/operations/logic";
import { QuantityInput } from "~/features/operations/QuantityInput";
import {
  type ReworkTarget,
  useReworkTargets,
  useScrapReasons
} from "~/features/operations/useLookups";

/**
 * Closing the lot.
 *
 * **One-shot, and that is why this sheet asks everything up front.** The
 * command closes the lot before it posts anything, so a disposition cannot be
 * amended, retried or reopened — all three terminal statuses are hard. A
 * missing field here is not a validation error the inspector can come back
 * from; it is a silently unposted scrap. Two server rules make that literal:
 * scrap posts only with a reason, and rework only with BOTH a target
 * operation and a reason. So this sheet requires exactly those, rather than
 * letting the server accept the close and drop the posting.
 *
 * **Accept and Reject only.** `Partial` — some units passed, some failed, both
 * posted in one close — additionally requires every unit in the lot to be
 * inspected, and on a serial lot it needs each unit routed individually to
 * scrap or rework. That allocation is a table, and a table is the thing this
 * screen exists to avoid; it stays on web MES, and the sheet says so rather
 * than offering a button that would be refused.
 */
export function DispositionSheet({
  sheetRef,
  operationId,
  isSerial,
  canAccept,
  canReject,
  acceptRemaining,
  failedCount,
  openUnitCount,
  issueTypes,
  pending,
  error,
  onSubmit
}: {
  sheetRef: React.RefObject<SheetHandle | null>;
  operationId: string;
  isSerial: boolean;
  canAccept: boolean;
  canReject: boolean;
  /** What Accept will complete. */
  acceptRemaining: number;
  failedCount: number;
  /** Serial only: the units still open at this operation. */
  openUnitCount: number;
  issueTypes: { id: string; name: string }[];
  pending: boolean;
  error: string | null;
  onSubmit: (args: {
    decision: InspectionDecision;
    scrapQuantity?: number;
    reworkQuantity?: number;
    scrapReasonId?: string;
    targetOperationId?: string;
    reworkReason?: string;
    createNcr?: boolean;
    nonConformanceTypeId?: string;
  }) => void;
}) {
  const { t } = useLingui();
  const colors = useThemeColors();
  const [decision, setDecision] = useState<"Accept" | "Reject" | null>(null);

  // A serial reject condemns every open unit; there is no quantity to choose.
  const [scrapQuantity, setScrapQuantity] = useState("");
  const [reworkQuantity, setReworkQuantity] = useState("");
  const [scrapReasonId, setScrapReasonId] = useState<string | null>(null);
  const [targetOperationId, setTargetOperationId] = useState<string | null>(
    null
  );
  const [reworkReason, setReworkReason] = useState("");
  const [createNcr, setCreateNcr] = useState(false);
  const [issueTypeId, setIssueTypeId] = useState<string | null>(null);

  const rejecting = decision === "Reject";
  // Lookups load with the sheet's reject branch, not with the screen: an
  // inspector who accepts every lot never pays for them.
  const scrapReasons = useScrapReasons(rejecting);
  const reworkTargets = useReworkTargets(operationId, rejecting);

  const scrap = isSerial ? openUnitCount : (parseQuantity(scrapQuantity) ?? 0);
  const rework = isSerial ? 0 : (parseQuantity(reworkQuantity) ?? 0);

  // Each posting needs its whole set of fields or the server drops it.
  const scrapReady = scrap <= 0 || Boolean(scrapReasonId);
  const reworkReady =
    rework <= 0 || Boolean(targetOperationId && reworkReason.trim());
  const canSubmit =
    decision === "Accept"
      ? canAccept
      : canReject && scrap + rework > 0 && scrapReady && reworkReady;

  const reset = () => {
    setDecision(null);
    setScrapQuantity("");
    setReworkQuantity("");
    setScrapReasonId(null);
    setTargetOperationId(null);
    setReworkReason("");
    setCreateNcr(false);
    setIssueTypeId(null);
  };

  const choice = (
    label: string,
    description: string,
    value: "Accept" | "Reject",
    enabled: boolean,
    disabledReason: string
  ) => (
    <Pressable
      onPress={() => enabled && setDecision(value)}
      disabled={!enabled}
      accessibilityRole="button"
      accessibilityState={{ selected: decision === value, disabled: !enabled }}
      accessibilityHint={enabled ? undefined : disabledReason}
      className={`min-h-[72px] flex-row items-center gap-3 rounded-lg border p-3 ${
        decision === value
          ? value === "Accept"
            ? "border-emerald-600 bg-emerald-500/10"
            : "border-red-500 bg-red-500/10"
          : "border-border bg-background"
      } ${enabled ? "active:opacity-70" : "opacity-40"}`}
    >
      <View className="min-w-0 flex-1">
        <Body className="font-semibold">{label}</Body>
        {/* A disabled choice SAYS why — never just greys out (design rule). */}
        <Muted className="text-sm">
          {enabled ? description : disabledReason}
        </Muted>
      </View>
      {decision === value ? (
        <Check size={20} color={colors.primary} />
      ) : (
        <ChevronRight size={20} color={colors.mutedForeground} />
      )}
    </Pressable>
  );

  const picker = <T extends { id: string }>(
    options: T[],
    selected: string | null,
    onPick: (id: string) => void,
    label: (option: T) => string
  ) => (
    <View className="gap-2">
      {options.map((option) => (
        <Pressable
          key={option.id}
          onPress={() => onPick(option.id)}
          accessibilityRole="button"
          accessibilityState={{ selected: selected === option.id }}
          className={`min-h-[48px] flex-row items-center gap-3 rounded-lg border px-3 active:opacity-70 ${
            selected === option.id
              ? "border-primary bg-primary/10"
              : "border-border bg-background"
          }`}
        >
          <Text className="flex-1 text-base text-foreground" numberOfLines={1}>
            {label(option)}
          </Text>
          {selected === option.id ? (
            <Check size={18} color={colors.primary} />
          ) : null}
        </Pressable>
      ))}
    </View>
  );

  const targetLabel = (target: ReworkTarget) =>
    target.description ?? target.processId ?? target.id;

  return (
    <Sheet ref={sheetRef} title={t`Close the lot`}>
      <View className="gap-3 px-2">
        {choice(
          t`Accept`,
          t`Complete ${acceptRemaining} and pass the lot`,
          "Accept",
          canAccept,
          failedCount > 0
            ? t`Some units failed — accept is not available`
            : t`Not every characteristic has the readings it needs`
        )}
        {choice(
          t`Reject`,
          isSerial
            ? t`Condemn ${openUnitCount} open units`
            : t`Scrap or rework the failed units`,
          "Reject",
          canReject,
          t`Nothing has failed yet`
        )}

        {rejecting ? (
          <View className="gap-4 pt-1">
            {isSerial ? (
              <WarningNote>
                {t`All ${openUnitCount} open units will be scrapped. To send some to rework instead, close this lot in Carbon MES on the web.`}
              </WarningNote>
            ) : (
              <>
                <QuantityInput
                  value={scrapQuantity}
                  onChange={setScrapQuantity}
                  label={t`Scrap`}
                  max={failedCount}
                />
                <QuantityInput
                  value={reworkQuantity}
                  onChange={setReworkQuantity}
                  label={t`Rework`}
                  max={failedCount}
                />
              </>
            )}

            {scrap > 0 ? (
              <View className="gap-2">
                {/* Required, not optional: the server posts no scrap without
                    it, and the lot would close with nothing recorded. */}
                <Muted className="text-sm">{t`Scrap reason`}</Muted>
                {scrapReasons.isPending ? (
                  <Skeleton className="h-12" />
                ) : (
                  picker(
                    scrapReasons.data ?? [],
                    scrapReasonId,
                    setScrapReasonId,
                    (reason) => reason.name
                  )
                )}
              </View>
            ) : null}

            {rework > 0 ? (
              <View className="gap-2">
                <Muted className="text-sm">{t`Send rework back to`}</Muted>
                {reworkTargets.isPending ? (
                  <Skeleton className="h-12" />
                ) : (
                  picker(
                    reworkTargets.data ?? [],
                    targetOperationId,
                    setTargetOperationId,
                    targetLabel
                  )
                )}
                <Field
                  label={t`Rework reason`}
                  value={reworkReason}
                  onChangeText={setReworkReason}
                  placeholder={t`What has to be put right`}
                  multiline
                />
              </View>
            ) : null}

            <Pressable
              onPress={() => setCreateNcr((was) => !was)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: createNcr }}
              className="min-h-[48px] flex-row items-center gap-3 rounded-lg border border-border bg-background px-3 active:opacity-70"
            >
              <View
                className={`size-6 items-center justify-center rounded border ${
                  createNcr
                    ? "border-primary bg-primary"
                    : "border-input bg-background"
                }`}
              >
                {createNcr ? (
                  <Check size={16} color={colors.primaryForeground} />
                ) : null}
              </View>
              <Text className="flex-1 text-base text-foreground">
                {t`Raise a quality issue`}
              </Text>
            </Pressable>

            {createNcr && issueTypes.length > 0 ? (
              <View className="gap-2">
                <Muted className="text-sm">{t`Issue type`}</Muted>
                {picker(
                  issueTypes,
                  issueTypeId,
                  setIssueTypeId,
                  (type) => type.name
                )}
              </View>
            ) : null}
          </View>
        ) : null}

        {error ? <ErrorNote>{error}</ErrorNote> : null}

        {decision ? (
          <View className="gap-2 pt-2">
            <Button
              variant={decision === "Reject" ? "destructive" : "primary"}
              loading={pending}
              disabled={!canSubmit}
              onPress={() =>
                onSubmit({
                  decision,
                  scrapQuantity:
                    decision === "Reject" && !isSerial && scrap > 0
                      ? scrap
                      : undefined,
                  reworkQuantity:
                    decision === "Reject" && !isSerial && rework > 0
                      ? rework
                      : undefined,
                  scrapReasonId:
                    decision === "Reject" && scrap > 0
                      ? (scrapReasonId ?? undefined)
                      : undefined,
                  targetOperationId:
                    decision === "Reject" && rework > 0
                      ? (targetOperationId ?? undefined)
                      : undefined,
                  reworkReason:
                    decision === "Reject" && rework > 0
                      ? reworkReason.trim()
                      : undefined,
                  createNcr: decision === "Reject" ? createNcr : undefined,
                  nonConformanceTypeId:
                    decision === "Reject" && createNcr
                      ? (issueTypeId ?? undefined)
                      : undefined
                })
              }
            >
              {decision === "Accept" ? t`Accept the lot` : t`Reject the lot`}
            </Button>
            <Button variant="ghost" onPress={reset} disabled={pending}>
              {t`Choose something else`}
            </Button>
          </View>
        ) : null}
      </View>
    </Sheet>
  );
}
