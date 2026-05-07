import { Boolean, useControlField, ValidatedForm } from "@carbon/form";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  ChoiceCardGroup,
  Combobox,
  HStack,
  Label,
  Switch,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  LuCalendarClock,
  LuClipboardCheck,
  LuLayers,
  LuTriangleAlert
} from "react-icons/lu";
import type { z } from "zod";
import {
  CustomFormFields,
  Hidden,
  NumberControlled,
  ShelfLifeStartProcess,
  ShelfLifeStartTiming,
  Submit
} from "~/components/Form";
import { StorageUnitDrillSelectField } from "~/components/Form/StorageUnitDrillSelect";
import { usePermissions, useSettings } from "~/hooks";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";
import {
  pickMethodWithShelfLifeValidator,
  type shelfLifeModes
} from "../../items.models";

type ShelfLifeMode = (typeof shelfLifeModes)[number];
type ReplenishmentSystem = "Buy" | "Make" | "Buy and Make";

type PickMethodFormProps = {
  initialValues: z.infer<typeof pickMethodWithShelfLifeValidator>;
  locations: ListItem[];
  type: "Part" | "Material" | "Tool" | "Consumable";
  storageUnits: { value: string; label: string }[];
  /**
   * Used to decide whether to render the shelf-life controls. Shelf life
   * only makes sense for items with per-unit records (Serial / Batch)
   * since batchNumber / serialNumber are where the expiry date is set.
   * Fungible tracking types have no per-unit row, so the fields are hidden.
   */
  itemTrackingType: string;
  /**
   * Filters the shelf-life mode options. `Make` items hide `Set on Receipt`
   * (nothing is received), `Buy` items hide `Calculated` (no BoM is
   * consumed). `Buy and Make` / null keeps every mode.
   */
  replenishmentSystem: ReplenishmentSystem | null;
  /**
   * Whether the active make-method has at least one BOM input with a
   * managed shelf-life policy. Used to warn the user when they pick a
   * BOM-driven shelf-life option (Calculated mode, or Fixed Duration with
   * Calculate-from-BOM) but no input would actually contribute an expiry.
   */
  bomHasShelfLifeManagedInput?: boolean;
};

const PickMethodForm = ({
  initialValues,
  locations,
  storageUnits,
  type,
  itemTrackingType,
  replenishmentSystem,
  bomHasShelfLifeManagedInput
}: PickMethodFormProps) => {
  const permissions = usePermissions();
  const { t } = useLingui();

  const locationOptions = locations.map((location) => ({
    label: location.name,
    value: location.id
  }));

  const shelfLifeApplicable =
    itemTrackingType === "Serial" || itemTrackingType === "Batch";

  return (
    <Card>
      <ValidatedForm
        method="post"
        validator={pickMethodWithShelfLifeValidator}
        defaultValues={initialValues}
      >
        <HStack className="w-full justify-between items-start">
          <CardHeader>
            <CardTitle>
              <Trans>Inventory</Trans>
            </CardTitle>
          </CardHeader>

          <CardAction>
            <Combobox
              asButton
              size="sm"
              value={initialValues.locationId}
              options={locationOptions}
              onChange={(selected) => {
                // hard refresh because initialValues update has no effect otherwise
                window.location.href = getLocationPath(
                  initialValues.itemId,
                  selected,
                  type
                );
              }}
            />
          </CardAction>
        </HStack>

        <CardContent>
          <Hidden name="itemId" />
          <Hidden name="locationId" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-8 gap-y-4 w-full">
            <StorageUnitDrillSelectField
              name="defaultStorageUnitId"
              label={t`Default Storage Unit`}
              locationId={initialValues.locationId}
              className="w-full"
            />

            {shelfLifeApplicable && (
              <ShelfLifeFields
                replenishmentSystem={replenishmentSystem}
                itemId={initialValues.itemId}
                bomHasShelfLifeManagedInput={bomHasShelfLifeManagedInput}
              />
            )}

            <CustomFormFields table="partInventory" />
          </div>
        </CardContent>
        <CardFooter>
          <Submit isDisabled={!permissions.can("update", "parts")}>
            <Trans>Save</Trans>
          </Submit>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
};

export default PickMethodForm;

type ManagedShelfLifeMode = Exclude<ShelfLifeMode, "NotManaged">;

const ALL_SHELF_LIFE_MODES: ManagedShelfLifeMode[] = [
  "Fixed Duration",
  "Calculated",
  "Set on Receipt"
];

// The "has shelf life" checkbox is local state. When unchecked, the
// hidden input submits "", which the validator coerces to "NotManaged"
// (items.models.ts) so the service deletes the itemShelfLife row
// (items.service.ts upsertItemShelfLife).
function ShelfLifeFields({
  replenishmentSystem,
  itemId,
  bomHasShelfLifeManagedInput
}: {
  replenishmentSystem: ReplenishmentSystem | null;
  itemId: string;
  bomHasShelfLifeManagedInput?: boolean;
}) {
  const { t } = useLingui();
  const { inventoryShelfLife } = useSettings();
  const defaultShelfLifeDays =
    (inventoryShelfLife as { defaultShelfLifeDays?: number } | null)
      ?.defaultShelfLifeDays ?? 7;
  const shelfLifeOptionCopy: Record<
    Exclude<ShelfLifeMode, "NotManaged">,
    { title: string; description: string; icon: ReactNode }
  > = {
    "Fixed Duration": {
      title: t`Fixed Shelf Life`,
      icon: <LuCalendarClock />,
      description:
        replenishmentSystem === "Buy"
          ? t`Store a fixed number of days on this item. Expiry start date is set on each batch or serial when it's received.`
          : replenishmentSystem === "Make"
            ? t`Store a fixed number of days on this item. Expiry start date is set on each batch or serial when it's created (or when the trigger process runs, if set).`
            : t`Store a fixed number of days on this item. Expiry start date is set on each batch or serial when it's received or created (or when the trigger process runs, if set).`
    },
    Calculated: {
      title: t`Inherit From Materials`,
      icon: <LuLayers />,
      description: t`Take the shortest remaining shelf life across the materials consumed to make this item. Use when the product's expiry depends on its ingredients.`
    },
    "Set on Receipt": {
      title: t`Entered At Receipt`,
      icon: <LuClipboardCheck />,
      description: t`A user records the expiry date on each batch or serial when the goods are received. Use when suppliers ship lots with different expiry dates.`
    }
  };
  const [shelfLifeMode, setShelfLifeMode] = useControlField<
    ShelfLifeMode | "" | undefined
  >("shelfLifeMode");
  const [shelfLifeDays, setShelfLifeDays] = useControlField<number | undefined>(
    "shelfLifeDays"
  );
  const [shelfLifeTriggerProcessId, setShelfLifeTriggerProcessId] =
    useControlField<string | undefined>("shelfLifeTriggerProcessId");
  const [shelfLifeCalculateFromBom, setShelfLifeCalculateFromBom] =
    useControlField<boolean | undefined>("shelfLifeCalculateFromBom");

  const availableModes = useMemo<ManagedShelfLifeMode[]>(() => {
    return ALL_SHELF_LIFE_MODES.filter((mode) => {
      if (replenishmentSystem === "Make" && mode === "Set on Receipt")
        return false;
      if (replenishmentSystem === "Buy" && mode === "Calculated") return false;
      return true;
    });
  }, [replenishmentSystem]);

  const initialHasShelfLife = !!shelfLifeMode && shelfLifeMode !== "NotManaged";
  const [hasShelfLife, setHasShelfLife] = useState(initialHasShelfLife);

  // If the current mode isn't allowed by the replenishment system, fall
  // back to the first allowed option so the ChoiceCardGroup's controlled
  // value stays valid.
  useEffect(() => {
    if (
      hasShelfLife &&
      shelfLifeMode &&
      shelfLifeMode !== "NotManaged" &&
      !availableModes.includes(shelfLifeMode as ManagedShelfLifeMode)
    ) {
      setShelfLifeMode(availableModes[0]);
    }
  }, [availableModes, hasShelfLife, shelfLifeMode, setShelfLifeMode]);

  // Keep the days value consistent with the mode: clear it when the user
  // switches away from Fixed Duration so the validator doesn't reject a
  // stale value on submit.
  useEffect(() => {
    if (shelfLifeMode !== "Fixed Duration" && shelfLifeDays !== undefined) {
      setShelfLifeDays(undefined);
    }
  }, [shelfLifeMode, shelfLifeDays, setShelfLifeDays]);

  // Buy-only items can't have a manufacturing trigger process — null it
  // out so a stale value from a prior replenishment setting doesn't persist.
  useEffect(() => {
    if (replenishmentSystem === "Buy") {
      setShelfLifeTriggerProcessId(undefined);
      setShelfLifeCalculateFromBom(false);
    }
  }, [
    replenishmentSystem,
    setShelfLifeTriggerProcessId,
    setShelfLifeCalculateFromBom
  ]);

  // Inherit-from-inputs only applies when mode is Fixed Duration. Coerce
  // back to false on a mode swap so the row never carries a stale flag
  // (the table CHECK enforces this server-side, but client-side reset
  // keeps the form submission clean).
  useEffect(() => {
    if (shelfLifeMode !== "Fixed Duration") {
      setShelfLifeCalculateFromBom(false);
    }
  }, [shelfLifeMode, setShelfLifeCalculateFromBom]);

  const handleToggle = (next: boolean) => {
    setHasShelfLife(next);
    if (next) {
      const current = shelfLifeMode;
      if (
        !current ||
        current === "NotManaged" ||
        !availableModes.includes(current as ManagedShelfLifeMode)
      ) {
        setShelfLifeMode(availableModes[0]);
      }
    } else {
      setShelfLifeMode("");
      setShelfLifeDays(undefined);
      setShelfLifeTriggerProcessId(undefined);
      setShelfLifeCalculateFromBom(false);
    }
  };

  const choiceValue: ShelfLifeMode =
    hasShelfLife && shelfLifeMode && shelfLifeMode !== "NotManaged"
      ? (shelfLifeMode as ShelfLifeMode)
      : availableModes[0];

  return (
    <>
      <HStack className="lg:col-span-3 justify-between items-center gap-4 border-t border-border pt-4">
        <VStack spacing={1}>
          <Label htmlFor="hasShelfLife" className="text-sm cursor-pointer">
            <Trans>Shelf-Life</Trans>
          </Label>
          <p className="text-xs text-muted-foreground">
            <Trans>Track when batches or serials of this item expire.</Trans>
          </p>
        </VStack>
        <Switch
          id="hasShelfLife"
          checked={hasShelfLife}
          onCheckedChange={handleToggle}
        />
        <input
          type="hidden"
          name="shelfLifeMode"
          value={hasShelfLife ? choiceValue : ""}
        />
      </HStack>

      {hasShelfLife && (
        <div className="lg:col-span-3">
          <ChoiceCardGroup<ShelfLifeMode>
            value={choiceValue}
            onChange={setShelfLifeMode}
            options={availableModes.map((mode) => ({
              value: mode,
              title: shelfLifeOptionCopy[mode].title,
              description: shelfLifeOptionCopy[mode].description,
              icon: shelfLifeOptionCopy[mode].icon
            }))}
          />
        </div>
      )}

      {hasShelfLife && choiceValue === "Fixed Duration" && (
        <>
          <NumberControlled
            name="shelfLifeDays"
            label={t`Shelf Life (Days)`}
            minValue={1}
            value={shelfLifeDays ?? defaultShelfLifeDays}
          />
          {replenishmentSystem !== "Buy" && (
            <>
              <ShelfLifeStartProcess
                processName="shelfLifeTriggerProcessId"
                label={t`Shelf Life Start Process`}
                itemId={itemId}
              />
              {shelfLifeTriggerProcessId && (
                <div className="lg:col-span-3">
                  <ShelfLifeStartTiming
                    timingName="shelfLifeTriggerTiming"
                    label={t`Start Expiration`}
                  />
                </div>
              )}
              {/* Make-only: optional input cap. Output expiry never outlasts
                  the earliest input expiry; falls back to the fixed clock
                  when no input has a date. Mirrors the inventory-settings
                  "Calculate from BOM" copy. */}
              <div className="lg:col-span-3">
                <Boolean
                  name="shelfLifeCalculateFromBom"
                  label={t`Calculate from BOM`}
                  description={t`Output never outlasts its raw materials. Falls back to the fixed duration when no input has an expiry date.`}
                  value={!!shelfLifeCalculateFromBom}
                  onChange={(v) => setShelfLifeCalculateFromBom(v)}
                />
              </div>
            </>
          )}
        </>
      )}

      {hasShelfLife &&
        bomHasShelfLifeManagedInput !== true &&
        (choiceValue === "Calculated" ||
          (choiceValue === "Fixed Duration" &&
            !!shelfLifeCalculateFromBom &&
            replenishmentSystem !== "Buy")) && (
          <div className="lg:col-span-3">
            <Alert variant="warning">
              <LuTriangleAlert className="h-4 w-4" />
              <AlertTitle>
                <Trans>No BOM input has a shelf-life policy</Trans>
              </AlertTitle>
              <AlertDescription>
                <Trans>
                  This item's bill of materials has no inputs with shelf-life
                  enabled, so no expiry will be calculated from the BOM.
                </Trans>
              </AlertDescription>
            </Alert>
          </div>
        )}
    </>
  );
}

function getLocationPath(
  itemId: string,
  locationId: string,
  type: "Part" | "Material" | "Tool" | "Consumable"
) {
  switch (type) {
    case "Part":
      return `${path.to.partInventory(itemId)}?location=${locationId}`;
    case "Material":
      return `${path.to.materialInventory(itemId)}?location=${locationId}`;

    case "Tool":
      return `${path.to.toolInventory(itemId)}?location=${locationId}`;
    case "Consumable":
      return `${path.to.consumableInventory(itemId)}?location=${locationId}`;
    default:
      throw new Error(`Invalid item type: ${type}`);
  }
}
