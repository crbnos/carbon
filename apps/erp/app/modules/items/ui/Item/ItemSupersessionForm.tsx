import { ValidatedForm } from "@carbon/form";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  Status,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuTriangleAlert } from "react-icons/lu";
import type { z } from "zod";
import {
  DatePicker,
  Hidden,
  Item,
  Number as NumberForm,
  Select as SelectForm,
  Submit
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import {
  itemSupersessionValidator,
  supersessionModes
} from "../../items.models";

type SupersessionMode = (typeof supersessionModes)[number];

// Single source of truth for how each supersession mode is presented — the same
// color is used everywhere the mode shows up (the mode picker options and the
// item lifecycle badge), so the two never drift.
const supersessionModeMeta: Record<
  SupersessionMode,
  { color: "green" | "blue" | "orange" | "red"; description: string }
> = {
  "Consume First": {
    color: "green",
    description: "Use remaining stock before switching to the successor"
  },
  "Prefer New": {
    color: "blue",
    description: "Default to the successor; old part as fallback only"
  },
  "Stock Only": {
    color: "orange",
    description: "Hold a minimum reserve for service; no production use"
  },
  "No Stock": {
    color: "red",
    description: "Fully obsolete — do not plan or stock"
  }
};

// Derived lifecycle status shown on the item header (PRD: Active has no badge).
// Labelled with the mode name so it matches the mode picker exactly.
export function getItemLifecycleStatus(
  mode: SupersessionMode | null | undefined
): { label: string; color: "green" | "blue" | "orange" | "red" } | null {
  if (!mode) return null;
  const meta = supersessionModeMeta[mode];
  if (!meta) return null;
  return { label: mode, color: meta.color };
}

type SupersessionChainLink = {
  itemId: string;
  successorItemId: string | null;
  successor: { readableIdWithRevision: string | null } | null;
};

type ItemSupersessionFormProps = {
  initialValues: z.infer<typeof itemSupersessionValidator> & {
    minimumReserveQuantity: number;
  };
  type: "Part" | "Material" | "Tool" | "Consumable";
  locationId: string;
  itemReadableId: string;
  quantityOnHand: number;
  chain: SupersessionChainLink[];
};

const ItemSupersessionForm = ({
  initialValues,
  type,
  locationId,
  itemReadableId,
  quantityOnHand,
  chain
}: ItemSupersessionFormProps) => {
  const permissions = usePermissions();
  const { t } = useLingui();

  const [mode, setMode] = useState<SupersessionMode | "">(
    initialValues.supersessionMode ?? ""
  );

  const hasSuccessor = mode !== "" && mode !== "No Stock";
  const hasReserve = mode === "Stock Only";

  // A -> B -> C: this item's successor itself has a successor.
  const hasChain = chain.length > 1;
  const chainLabel = hasChain
    ? [
        itemReadableId,
        ...chain.map(
          (link) =>
            link.successor?.readableIdWithRevision ?? link.successorItemId
        )
      ]
        .filter(Boolean)
        .join(" → ")
    : null;

  return (
    <Card>
      <ValidatedForm
        method="post"
        validator={itemSupersessionValidator}
        defaultValues={initialValues}
      >
        <CardHeader>
          <CardTitle>
            <Trans>Supersession</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Hidden name="intent" value="supersession" />
          <Hidden name="itemId" />
          <Hidden name="locationId" value={locationId} />
          <VStack spacing={4}>
            {hasChain && chainLabel && (
              <Alert variant="destructive">
                <LuTriangleAlert className="h-4 w-4 !top-3.5" />
                <AlertTitle>
                  <Trans>Supersession chain detected</Trans>
                </AlertTitle>
                <AlertDescription>
                  <Trans>
                    {chainLabel}. Consider pointing this part directly at the
                    final successor.
                  </Trans>
                </AlertDescription>
              </Alert>
            )}
            {mode === "No Stock" && quantityOnHand > 0 && (
              <Alert>
                <LuTriangleAlert className="h-4 w-4 !top-3.5" />
                <AlertTitle>
                  <Trans>On-hand inventory remains</Trans>
                </AlertTitle>
                <AlertDescription>
                  <Trans>
                    This part has {quantityOnHand} on hand at this location. No
                    Stock means it will be neither planned nor consumed.
                  </Trans>
                </AlertDescription>
              </Alert>
            )}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-8 gap-y-4 w-full">
              <SelectForm
                name="supersessionMode"
                label={t`Supersession Mode`}
                termId="supersession-mode"
                placeholder={t`None`}
                helperText={
                  mode ? supersessionModeMeta[mode].description : undefined
                }
                options={supersessionModes.map((value) => ({
                  label: (
                    <Status color={supersessionModeMeta[value].color}>
                      {value}
                    </Status>
                  ),
                  value
                }))}
                onChange={(selected) => {
                  setMode((selected?.value as SupersessionMode) ?? "");
                }}
              />
              {mode !== "" && (
                <DatePicker
                  name="discontinuationDate"
                  label={t`Discontinuation Date`}
                  isRequired
                  helperText={t`Stop raising purchase orders after this date`}
                />
              )}
              {hasReserve && (
                <NumberForm
                  name="minimumReserveQuantity"
                  label={t`Minimum Reserve Quantity`}
                  minValue={0}
                  helperText={t`On-hand floor to maintain for service use at this location`}
                />
              )}
              {hasSuccessor && (
                <>
                  <Item
                    name="successorItemId"
                    label={t`Successor Part`}
                    type={type}
                    isOptional={false}
                    blacklist={[initialValues.itemId]}
                  />
                  <DatePicker
                    name="successorEffectivityDate"
                    label={t`Successor Effectivity Date`}
                    helperText={t`When MRP uses the successor for new demand`}
                  />
                  <NumberForm
                    name="conversionFactor"
                    label={t`Conversion Factor`}
                    minValue={0}
                    helperText={t`How many of the successor replace one old part`}
                  />
                </>
              )}
            </div>
          </VStack>
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

export default ItemSupersessionForm;
