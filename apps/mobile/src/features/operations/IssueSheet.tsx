// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { OperationMaterial } from "@carbon/mes-core";
import { formatDate } from "@carbon/utils/date";
import { formatQuantity } from "@carbon/utils/format";
import { getLocalTimeZone, today } from "@internationalized/date";
import { useLingui } from "@lingui/react/macro";
import { Camera, Check, Circle, CircleCheck, X } from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { toast } from "sonner-native";
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
import { CameraScanner } from "~/features/scan/CameraScanner";
import {
  commandMessage,
  useIssueMaterial,
  useIssueTracked,
  useUnconsume
} from "./commands";
import {
  type ConsumedInput,
  isTrackedLine,
  parseQuantity,
  untrackedIssueBody
} from "./logic";
import { QuantityInput } from "./QuantityInput";
import {
  matchEntityToScan,
  selectableEntities,
  serialSlotsLeft,
  trackedIssueBody
} from "./trackedIssue";
import { useAvailableEntities } from "./useAvailableEntities";

/**
 * One material line, as the screen that opened the sheet holds it.
 *
 * The two screens hold a line to different things, which is why the numbers
 * are passed in rather than read off the material: the operation screen issues
 * against the whole job's requirement, and the assembly screen against ONE
 * unit's — a default of ten on a ten-unit job is how every unit's worth gets
 * charged to the first one.
 */
export type IssueTarget = {
  operationId: string;
  material: OperationMaterial;
  /** What this screen holds the line to, and how much of that is in. */
  required: number;
  issued: number;
  /** Offered in the quantity field: what is still to issue. */
  suggested: number;
  /** The unit being built — what tracked parts become children of. */
  parentEntityId?: string;
  /** Assembly only: the step and the 1-based unit a consume is stamped with. */
  jobOperationStepId?: string;
  unitNumber?: number;
  /** `Warn`, `Block` or `BlockWithOverride` — the company's setting. */
  expiredEntityPolicy?: string | null;
  /** Lots and serials already consumed against this line. */
  consumed: ConsumedInput[];
};

/**
 * Issue one material line.
 *
 * Two different writes behind one sheet, because they are one action to an
 * operator. An untracked part is a quantity. A serial- or batch-tracked part is
 * a specific ENTITY, and which one it is becomes part of the unit's genealogy —
 * so it is issued by scanning its label or choosing it from what is on the
 * shelf, never by typing a number.
 */
export function IssueSheet({
  target,
  onClose
}: {
  target: IssueTarget;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const sheet = useRef<SheetHandle>(null);
  const { material } = target;

  // The sheet is mounted only while a material is selected, so it opens
  // itself; dismissing it tells the caller to unmount it.
  useEffect(() => {
    sheet.current?.open();
  }, []);

  return (
    <Sheet ref={sheet} title={material.itemReadableId ?? t`Issue material`}>
      <View className="gap-4 px-2 pt-2">
        {material.description ? (
          <Muted className="text-sm">{material.description}</Muted>
        ) : null}
        {isTrackedLine(material) ? (
          <TrackedIssue target={target} onClose={onClose} />
        ) : (
          <UntrackedIssue target={target} onClose={onClose} />
        )}
      </View>
    </Sheet>
  );
}

function IssuedSoFar({ target }: { target: IssueTarget }) {
  const { t, i18n } = useLingui();
  const locale = i18n.locale || "en";
  return (
    <View className="flex-row items-baseline gap-2">
      <Body className="text-xl font-semibold">
        {formatQuantity(target.issued, locale)}
      </Body>
      <Muted className="text-sm">
        {t`of ${formatQuantity(target.required, locale)} ${target.material.unitOfMeasureCode ?? ""} issued`}
      </Muted>
    </View>
  );
}

function UntrackedIssue({
  target,
  onClose
}: {
  target: IssueTarget;
  onClose: () => void;
}) {
  const { t, i18n } = useLingui();
  const locale = i18n.locale || "en";
  const { material } = target;
  const [quantity, setQuantity] = useState(String(target.suggested));
  const issue = useIssueMaterial(target.operationId);
  const value = parseQuantity(quantity);
  const outstanding = target.required - target.issued;

  const submit = async () => {
    if (!value || !material.itemId) return;
    try {
      await issue.mutateAsync(
        untrackedIssueBody({
          itemId: material.itemId,
          materialId: material.id,
          quantity: value,
          // Only an unplanned part is scoped to a step; a planned one already
          // belongs to the steps its line is linked to.
          jobOperationStepId: material.id
            ? undefined
            : target.jobOperationStepId
        })
      );
      onClose();
      toast.success(
        t`Issued ${formatQuantity(value, locale)} ${material.itemReadableId ?? ""}`
      );
    } catch (error) {
      // A `blocked` 409 carries the rule that refused it. The operator reads
      // the reason and decides; nothing here retries on their behalf.
      toast.error(commandMessage(error, t`Could not issue that material`));
    }
  };

  return (
    <>
      <IssuedSoFar target={target} />
      <QuantityInput
        label={t`How many are you issuing?`}
        value={quantity}
        onChange={setQuantity}
        max={outstanding > 0 ? outstanding : undefined}
      />
      <Button onPress={submit} disabled={!value} loading={issue.isPending}>
        {value
          ? t`Issue ${formatQuantity(value, locale)}`
          : t`Enter a quantity`}
      </Button>
      <Button variant="ghost" onPress={onClose} disabled={issue.isPending}>
        {t`Cancel`}
      </Button>
    </>
  );
}

function TrackedIssue({
  target,
  onClose
}: {
  target: IssueTarget;
  onClose: () => void;
}) {
  const { t, i18n } = useLingui();
  const locale = i18n.locale || "en";
  const colors = useThemeColors();
  const { material } = target;
  const serial = material.requiresSerialTracking === true;

  const available = useAvailableEntities(material.itemId, true);
  const issue = useIssueTracked(target.operationId);
  const unconsume = useUnconsume(target.operationId);

  const [code, setCode] = useState("");
  const [camera, setCamera] = useState(false);
  // Entity id → the quantity taken from it. A serial is always 1.
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);

  const policy = target.expiredEntityPolicy ?? "Block";
  const day = useMemo(() => today(getLocalTimeZone()).toString(), []);
  const entities = useMemo(
    () => selectableEntities(available.data ?? [], policy, day),
    [available.data, policy, day]
  );

  const pickedIds = Object.keys(picked);
  const outstanding = target.required - target.issued;
  const slots = serialSlotsLeft({
    required: target.required,
    issued: target.issued,
    selected: pickedIds.length
  });
  const expiredPicked = entities.some(
    (entity) => entity.expired && picked[entity.id] !== undefined
  );
  const needsReason = expiredPicked && policy === "BlockWithOverride";

  const toggle = (entity: (typeof entities)[number]) => {
    setPicked((current) => {
      if (current[entity.id] !== undefined) {
        const { [entity.id]: _removed, ...rest } = current;
        return rest;
      }
      if (serial) {
        if (slots <= 0) {
          toast.error(t`That is all this part needs`);
          return current;
        }
        return { ...current, [entity.id]: "1" };
      }
      // A lot offers what is still outstanding, capped at what it holds. One
      // lot at a time: the common case is a single lot covering the line, and
      // a second one is a second tap.
      const want = outstanding > 0 ? outstanding : 1;
      const take = want < entity.quantity ? want : entity.quantity;
      return { [entity.id]: String(take) };
    });
  };

  const handleScan = (text: string) => {
    const match = matchEntityToScan(entities, text);
    setCode("");
    if (!match) {
      // Said plainly: a scanner that appears to do nothing is indistinguishable
      // from a label that is not on the shelf.
      toast.error(
        t`${text.trim()} is not an available ${material.itemReadableId ?? ""}`
      );
      return;
    }
    if (picked[match.id] === undefined) toggle(match);
  };

  const children = pickedIds
    .map((id) => ({
      trackedEntityId: id,
      quantity: serial ? 1 : (parseQuantity(picked[id] ?? "") ?? 0)
    }))
    .filter((child) => child.quantity > 0);
  const overdrawn = entities.some((entity) => {
    const taken = parseQuantity(picked[entity.id] ?? "");
    return taken !== null && taken > entity.quantity;
  });
  const total = children.reduce((sum, child) => sum + child.quantity, 0);
  const ready =
    Boolean(target.parentEntityId) &&
    children.length > 0 &&
    children.length === pickedIds.length &&
    !overdrawn &&
    (!needsReason || reason.trim().length > 0);

  const submit = async () => {
    if (!ready || !target.parentEntityId) return;
    try {
      await issue.mutateAsync(
        trackedIssueBody({
          materialId: material.id,
          itemId: material.itemId,
          parentEntityId: target.parentEntityId,
          children,
          jobOperationStepId: target.jobOperationStepId,
          unitNumber: target.unitNumber,
          overrideReason: expiredPicked ? reason : undefined
        })
      );
      onClose();
      toast.success(
        t`Issued ${formatQuantity(total, locale)} ${material.itemReadableId ?? ""}`
      );
    } catch (error) {
      toast.error(commandMessage(error, t`Could not issue that material`));
    }
  };

  const remove = async (input: ConsumedInput) => {
    if (!target.parentEntityId || !material.id) return;
    setRemoving(input.id);
    try {
      await unconsume.mutateAsync({
        materialId: material.id,
        parentTrackedEntityId: target.parentEntityId,
        children: [
          { trackedEntityId: input.id, quantity: serial ? 1 : input.quantity }
        ]
      });
      toast.success(t`Removed ${input.readableId ?? input.id}`);
      // It is back on the shelf: show it there, so it can be issued again.
      void available.refetch();
    } catch (error) {
      toast.error(commandMessage(error, t`Could not remove that`));
    } finally {
      setRemoving(null);
    }
  };

  const pending = issue.isPending;

  return (
    <>
      <IssuedSoFar target={target} />

      {!target.parentEntityId ? (
        <WarningNote>
          {t`This unit has no serial or lot number yet, so a tracked part cannot be issued to it.`}
        </WarningNote>
      ) : null}

      <View className="flex-row items-end gap-2">
        <View className="flex-1">
          <Field
            label={
              serial
                ? t`Scan or type the serial number`
                : t`Scan or type the lot number`
            }
            value={code}
            onChangeText={setCode}
            onSubmitEditing={() => {
              if (code.trim()) handleScan(code);
            }}
            autoCapitalize="characters"
            autoCorrect={false}
            returnKeyType="done"
            // A hardware scanner types into whatever is focused and ends with
            // Enter, so the sheet's own field IS the wedge.
            autoFocus
          />
        </View>
        <Pressable
          onPress={() => setCamera(!camera)}
          accessibilityRole="button"
          accessibilityState={{ expanded: camera }}
          accessibilityLabel={
            camera ? t`Turn the camera off` : t`Scan with the camera`
          }
          className={`size-12 items-center justify-center rounded-lg border active:opacity-70 ${
            camera ? "border-primary bg-muted" : "border-border bg-card"
          }`}
        >
          <Camera size={22} color={colors.foreground} />
        </Pressable>
      </View>

      {camera ? <CameraScanner onScan={handleScan} className="h-44" /> : null}

      <View className="gap-2">
        <Muted className="text-sm">
          {serial ? t`On the shelf` : t`Lots on the shelf`}
        </Muted>
        {available.isLoading ? (
          <View className="gap-2">
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
          </View>
        ) : available.isError ? (
          <ErrorNote>{t`Could not load what is on the shelf.`}</ErrorNote>
        ) : entities.length === 0 ? (
          <WarningNote>
            {t`Nothing is available to issue for this part.`}
          </WarningNote>
        ) : (
          entities.slice(0, 40).map((entity) => {
            const selected = picked[entity.id] !== undefined;
            return (
              <View key={entity.id} className="gap-2">
                <Pressable
                  onPress={() => toggle(entity)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: selected }}
                  accessibilityLabel={entity.readableId ?? entity.id}
                  className={`min-h-[56px] flex-row items-center gap-3 rounded-lg border px-3 py-2 active:opacity-70 ${
                    selected
                      ? "border-primary bg-muted"
                      : "border-border bg-card"
                  }`}
                >
                  {selected ? (
                    <CircleCheck size={22} color={colors.foreground} />
                  ) : (
                    <Circle size={22} color={colors.mutedForeground} />
                  )}
                  <View className="min-w-0 flex-1">
                    <Body className="font-semibold" numberOfLines={1}>
                      {entity.readableId ?? entity.id}
                    </Body>
                    <Muted className="text-sm" numberOfLines={1}>
                      {[
                        serial
                          ? null
                          : t`${formatQuantity(entity.quantity, locale)} available`,
                        entity.expirationDate
                          ? entity.expired
                            ? t`Expired ${formatDate(entity.expirationDate.slice(0, 10), undefined, locale)}`
                            : t`Expires ${formatDate(entity.expirationDate.slice(0, 10), undefined, locale)}`
                          : null
                      ]
                        .filter(Boolean)
                        .join(" · ") || entity.id}
                    </Muted>
                  </View>
                  {entity.expired ? (
                    <View className="rounded-md bg-red-500/15 px-2 py-1">
                      <Muted className="text-xs font-semibold text-red-600 dark:text-red-400">
                        {t`Expired`}
                      </Muted>
                    </View>
                  ) : null}
                </Pressable>
                {selected && !serial ? (
                  <LotQuantity
                    value={picked[entity.id] ?? ""}
                    available={entity.quantity}
                    onChange={(value) =>
                      setPicked((current) => ({
                        ...current,
                        [entity.id]: value
                      }))
                    }
                  />
                ) : null}
              </View>
            );
          })
        )}
        {entities.length > 40 ? (
          <Muted className="text-sm">
            {t`Showing the first 40. Scan a label to find another.`}
          </Muted>
        ) : null}
      </View>

      {expiredPicked ? (
        <View className="gap-2">
          <WarningNote>
            {needsReason
              ? t`This is past its expiry date. Give a reason to issue it anyway.`
              : t`This is past its expiry date.`}
          </WarningNote>
          <Field
            label={needsReason ? t`Reason` : t`Reason (optional)`}
            value={reason}
            onChangeText={setReason}
          />
        </View>
      ) : null}

      {target.consumed.length ? (
        <View className="gap-2">
          <Muted className="text-sm">{t`Already issued`}</Muted>
          {target.consumed.map((input) => (
            <View
              key={input.id}
              className="min-h-[52px] flex-row items-center gap-3 rounded-lg border border-border bg-card px-3"
            >
              <Check size={18} color={colors.mutedForeground} />
              <View className="min-w-0 flex-1">
                <Body numberOfLines={1}>{input.readableId ?? input.id}</Body>
                {serial ? null : (
                  <Muted className="text-sm">
                    {formatQuantity(input.quantity, locale)}
                  </Muted>
                )}
              </View>
              <Pressable
                onPress={() => remove(input)}
                disabled={removing !== null}
                accessibilityRole="button"
                accessibilityLabel={t`Remove ${input.readableId ?? input.id}`}
                className="size-11 items-center justify-center rounded-lg active:opacity-60"
              >
                <X size={20} color={colors.mutedForeground} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      <Button onPress={submit} disabled={!ready} loading={pending}>
        {overdrawn
          ? t`More than the lot holds`
          : total > 0
            ? t`Issue ${formatQuantity(total, locale)}`
            : serial
              ? t`Scan or choose a serial`
              : t`Scan or choose a lot`}
      </Button>
      <Button variant="ghost" onPress={onClose} disabled={pending}>
        {t`Cancel`}
      </Button>
    </>
  );
}

/** How much to take from one lot. A plain field: it sits inside a list row. */
function LotQuantity({
  value,
  available,
  onChange
}: {
  value: string;
  available: number;
  onChange: (value: string) => void;
}) {
  const { t, i18n } = useLingui();
  const locale = i18n.locale || "en";
  const colors = useThemeColors();
  return (
    <View className="flex-row items-center gap-3 pl-9">
      <Muted className="text-sm">{t`Take`}</Muted>
      <TextInput
        value={value}
        onChangeText={onChange}
        keyboardType="decimal-pad"
        selectTextOnFocus
        accessibilityLabel={t`Quantity from this lot`}
        placeholder="0"
        placeholderTextColor={colors.mutedForeground}
        className="min-h-[48px] w-28 rounded-lg border border-input bg-card px-3 text-center text-lg font-semibold text-foreground"
      />
      <Muted className="text-sm">
        {t`of ${formatQuantity(available, locale)}`}
      </Muted>
    </View>
  );
}
