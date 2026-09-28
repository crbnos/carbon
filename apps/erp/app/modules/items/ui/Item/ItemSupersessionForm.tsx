import { ValidatedForm } from "@carbon/form";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Status,
  useDisclosure,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useRef, useState } from "react";
import { LuPlus, LuTriangleAlert } from "react-icons/lu";
import { Link, useActionData } from "react-router";
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
import { path } from "~/utils/path";
import type { SupersessionMode } from "../../items.models";
import {
  itemSupersessionValidator,
  predecessorSupersessionValidator,
  supersessionModeMeta,
  supersessionModes
} from "../../items.models";

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

type SupersededByLink = {
  itemId: string;
  supersessionMode: SupersessionMode;
  successorEffectivityDate: string | null;
  predecessor: { readableIdWithRevision: string | null; name: string } | null;
};

type ItemType = "Part" | "Material" | "Tool" | "Consumable";

type ItemSupersessionFormProps = {
  initialValues: z.infer<typeof itemSupersessionValidator> & {
    minimumReserveQuantity: number;
  };
  type: ItemType;
  locationId: string;
  itemReadableId: string;
  quantityOnHand: number;
  chain: SupersessionChainLink[];
  supersededBy: SupersededByLink[];
};

const planningPath: Record<ItemType, (id: string) => string> = {
  Part: path.to.partPlanning,
  Material: path.to.materialPlanning,
  Tool: path.to.toolPlanning,
  Consumable: path.to.consumablePlanning
};

const ItemSupersessionForm = ({
  initialValues,
  type,
  locationId,
  itemReadableId,
  quantityOnHand,
  chain,
  supersededBy
}: ItemSupersessionFormProps) => {
  const permissions = usePermissions();
  const { t } = useLingui();
  const canUpdate = permissions.can("update", "parts");

  const [mode, setMode] = useState<SupersessionMode | "">(
    initialValues.supersessionMode ?? ""
  );
  const addPredecessorModal = useDisclosure();

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

  const discontinuationDateHelp =
    mode === "Consume First"
      ? t`Optional. Stops new purchase suggestions after this date.`
      : t`Stops new purchase suggestions after this date.`;

  return (
    <Card>
      <ValidatedForm
        method="post"
        validator={itemSupersessionValidator}
        defaultValues={initialValues}
      >
        <HStack className="justify-between">
          <CardHeader>
            <CardTitle>
              <Trans>Supersession</Trans>
            </CardTitle>
          </CardHeader>
          <CardAction>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                leftIcon={<LuPlus />}
                isDisabled={!canUpdate}
                onClick={addPredecessorModal.onOpen}
              >
                <Trans>Add Predecessor</Trans>
              </Button>
            </div>
          </CardAction>
        </HStack>
        <CardContent>
          <Hidden name="intent" value="supersession" />
          <Hidden name="itemId" />
          <Hidden name="locationId" value={locationId} />
          <VStack spacing={4}>
            {supersededBy.length > 0 && (
              <VStack spacing={1} className="w-full">
                <p className="text-sm font-medium">
                  <Trans>Supersedes</Trans>
                </p>
                <p className="text-xs text-muted-foreground">
                  <Trans>
                    These parts are being replaced by this one. Each rule is set
                    on the old part; open it to change the rule.
                  </Trans>
                </p>
                <ul className="w-full divide-y divide-border rounded-md border">
                  {supersededBy.map((link) => (
                    <li
                      key={link.itemId}
                      className="flex items-center justify-between gap-4 px-3 py-2"
                    >
                      <HStack spacing={2} className="min-w-0">
                        <Link
                          to={planningPath[type](link.itemId)}
                          className="truncate font-mono text-sm hover:underline"
                        >
                          {link.predecessor?.readableIdWithRevision ??
                            link.itemId}
                        </Link>
                        <span className="truncate text-sm text-muted-foreground">
                          {link.predecessor?.name}
                        </span>
                      </HStack>
                      <HStack spacing={2} className="shrink-0">
                        {link.successorEffectivityDate && (
                          <span className="text-xs text-muted-foreground">
                            <Trans>from</Trans> {link.successorEffectivityDate}
                          </span>
                        )}
                        <Status
                          color={
                            supersessionModeMeta[link.supersessionMode].color
                          }
                        >
                          {link.supersessionMode}
                        </Status>
                      </HStack>
                    </li>
                  ))}
                </ul>
              </VStack>
            )}
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
                  isRequired={mode !== "Consume First"}
                  helperText={discontinuationDateHelp}
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
          <Submit isDisabled={!canUpdate}>
            <Trans>Save</Trans>
          </Submit>
        </CardFooter>
      </ValidatedForm>
      {addPredecessorModal.isOpen && (
        <AddPredecessorModal
          itemId={initialValues.itemId}
          itemReadableId={itemReadableId}
          type={type}
          onClose={addPredecessorModal.onClose}
        />
      )}
    </Card>
  );
};

function AddPredecessorModal({
  itemId,
  itemReadableId,
  type,
  onClose
}: {
  itemId: string;
  itemReadableId: string;
  type: ItemType;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const [mode, setMode] = useState<SupersessionMode>("Consume First");
  const actionData = useActionData<{ fieldErrors?: unknown } | undefined>();
  const actionDataRef = useRef(actionData);
  actionDataRef.current = actionData;

  const discontinuationDateHelp =
    mode === "Consume First"
      ? t`Optional. Stops new purchase suggestions for the old part after this date.`
      : t`Stops new purchase suggestions for the old part after this date.`;

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent>
        <ValidatedForm
          method="post"
          validator={predecessorSupersessionValidator}
          defaultValues={{
            supersessionMode: "Consume First",
            conversionFactor: 1
          }}
          onAfterSubmit={() => {
            if (!actionDataRef.current?.fieldErrors) onClose();
          }}
        >
          <ModalHeader>
            <ModalTitle>
              <Trans>Add Predecessor</Trans>
            </ModalTitle>
            <ModalDescription>
              <Trans>
                Choose a part that {itemReadableId} replaces. The rule is saved
                on that part with {itemReadableId} as its successor.
              </Trans>
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <Hidden name="intent" value="supersession-predecessor" />
            <VStack spacing={4}>
              <Item
                name="predecessorItemId"
                label={t`Part Being Replaced`}
                type={type}
                isOptional={false}
                blacklist={[itemId]}
              />
              <SelectForm
                name="supersessionMode"
                label={t`Supersession Mode`}
                termId="supersession-mode"
                helperText={supersessionModeMeta[mode].description}
                options={supersessionModes
                  .filter((value) => value !== "No Stock")
                  .map((value) => ({
                    label: (
                      <Status color={supersessionModeMeta[value].color}>
                        {value}
                      </Status>
                    ),
                    value
                  }))}
                onChange={(selected) => {
                  if (selected?.value) {
                    setMode(selected.value as SupersessionMode);
                  }
                }}
              />
              <DatePicker
                name="discontinuationDate"
                label={t`Discontinuation Date`}
                isRequired={mode !== "Consume First"}
                helperText={discontinuationDateHelp}
              />
              <DatePicker
                name="successorEffectivityDate"
                label={t`Successor Effectivity Date`}
                helperText={t`When MRP starts using this part for the old part's demand`}
              />
              <NumberForm
                name="conversionFactor"
                label={t`Conversion Factor`}
                minValue={0}
                helperText={t`How many of this part replace one old part`}
              />
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Submit>
              <Trans>Add</Trans>
            </Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}

export default ItemSupersessionForm;
