import { ValidatedForm } from "@carbon/form";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  HStack,
  ModalDrawer,
  ModalDrawerBody,
  ModalDrawerContent,
  ModalDrawerFooter,
  ModalDrawerHeader,
  ModalDrawerProvider,
  ModalDrawerTitle,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { LuTriangleAlert } from "react-icons/lu";
import { useFetcher, useNavigate } from "react-router";
import { TrackingTypeIcon } from "~/components";
import {
  Hidden,
  Input,
  InputControlled,
  Item,
  Select,
  Submit
} from "~/components/Form";
import { ReplenishmentSystemIcon } from "~/components/Icons";
import { useNextItemId } from "~/hooks";
import { path } from "~/utils/path";
import {
  type ChangeOrderChangeType,
  changeOrderAffectedItemValidator,
  changeOrderChangeTypes,
  changeOrderNewPartValidator,
  itemReplenishmentSystems,
  itemTrackingTypes
} from "../../items.models";

// The "Add affected item" modal, opened from the sidebar's bottom button —
// mirrors the PO "Add Line Item" flow (bottom button → modal). On success it
// selects the new item by navigating to its URL (the middle pane is URL-driven).
//
// A single change-type Select drives the body: Version / Revision / Replacement
// Part pick an EXISTING Part; New Part reveals a create-new-part mini-form (mints
// a brand-new part under the change order). Change orders operate on Parts only —
// no Tool selection. The two modes are separate ValidatedForms (each with its own
// validator); the Select carries `changeType` so the route action can tell them
// apart.
function startsWithLetter(value: string) {
  return /^[A-Za-z]/.test(value);
}

export default function AffectedItemForm({
  changeOrderId,
  blacklist,
  onClose
}: {
  changeOrderId: string;
  blacklist: string[];
  onClose: () => void;
}) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const fetcher = useFetcher<{ success: boolean; id?: string }>();

  const [changeType, setChangeType] =
    useState<ChangeOrderChangeType>("Version");
  // A net-new affected item is always a Part (no Part/Tool choice) — mint under
  // the Part sequence.
  const { id: nextId, onIdChange, loading } = useNextItemId("Part");

  const isNewPart = changeType === "New Part";

  // Track the selected Part so we can warn when a Version change would promote its
  // current (draft) make method to Active. Fetch the item's method status on
  // selection; the warning shows only when it has a method but none is Active.
  const [selectedItemId, setSelectedItemId] = useState<string>("");
  const methodStatusFetcher = useFetcher<{
    hasActiveMethod: boolean;
    hasAnyMethod: boolean;
  }>();
  // Only re-fetch when the item/type changes; the fetcher identity is stable.
  // biome-ignore lint/correctness/useExhaustiveDependencies: fetcher is stable
  useEffect(() => {
    if (changeType === "Version" && selectedItemId) {
      methodStatusFetcher.load(
        path.to.api.itemMakeMethodStatus(selectedItemId)
      );
    }
  }, [changeType, selectedItemId]);
  const willActivateDraft =
    changeType === "Version" &&
    !!selectedItemId &&
    methodStatusFetcher.data?.hasAnyMethod === true &&
    methodStatusFetcher.data?.hasActiveMethod === false;

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success) {
      onClose();
      if (fetcher.data.id) {
        navigate(
          path.to.changeOrderAffectedItem(changeOrderId, fetcher.data.id)
        );
      }
    }
  }, [fetcher.state, fetcher.data, onClose, navigate, changeOrderId]);

  const changeTypeOptions = changeOrderChangeTypes.map((c) => ({
    label: c,
    value: c
  }));
  const translateItemTrackingType = (v: string) =>
    v === "Inventory"
      ? t`Inventory`
      : v === "Non-Inventory"
        ? t`Non-Inventory`
        : v === "Serial"
          ? t`Serial`
          : t`Batch`;
  const itemTrackingTypeOptions = itemTrackingTypes.map((itemTrackingType) => ({
    label: (
      <span className="flex items-center gap-2">
        <TrackingTypeIcon type={itemTrackingType} />
        {translateItemTrackingType(itemTrackingType)}
      </span>
    ),
    value: itemTrackingType
  }));
  const replenishmentOptions = itemReplenishmentSystems.map(
    (itemReplenishmentSystem) => ({
      label: (
        <span className="flex items-center gap-2">
          <ReplenishmentSystemIcon type={itemReplenishmentSystem} />
          {itemReplenishmentSystem === "Buy"
            ? t`Buy`
            : itemReplenishmentSystem === "Make"
              ? t`Make`
              : t`Buy and Make`}
        </span>
      ),
      value: itemReplenishmentSystem
    })
  );

  // The change-type Select is identical in both modes; `onChange` switches modes.
  const changeTypeField = (
    <Select
      name="changeType"
      label={t`Change type`}
      termId="change-order-change-type"
      options={changeTypeOptions}
      onChange={(o) =>
        setChangeType((o?.value as ChangeOrderChangeType) ?? "Version")
      }
    />
  );

  const footer = (
    <ModalDrawerFooter>
      <HStack>
        <Submit withBlocker={false}>
          <Trans>Add</Trans>
        </Submit>
        <Button size="md" variant="solid" onClick={onClose}>
          <Trans>Cancel</Trans>
        </Button>
      </HStack>
    </ModalDrawerFooter>
  );

  return (
    <ModalDrawerProvider type="modal">
      <ModalDrawer
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <ModalDrawerContent>
          {isNewPart ? (
            // Distinct `key` per branch is REQUIRED. Both branches render a
            // <ValidatedForm> at the same JSX slot, so React would reconcile them
            // as ONE instance and the RVF store would hydrate only once (on the
            // initial existing-item branch). syncFormProps seeds controlled-field
            // defaults only when `!isHydrated`, so on switch the New Part Selects
            // (replenishment/tracking) never get seeded → "" → enum error. The key
            // forces a fresh mount + fresh store that hydrates with these defaults.
            <ValidatedForm
              key="new-part"
              validator={changeOrderNewPartValidator}
              method="post"
              action={path.to.changeOrderAffected(changeOrderId)}
              defaultValues={{
                changeOrderId,
                changeType: "New Part",
                readableId: "",
                name: "",
                replenishmentSystem: "Make",
                itemTrackingType: "Inventory"
              }}
              fetcher={fetcher}
              className="flex flex-col h-full"
            >
              <ModalDrawerHeader>
                <ModalDrawerTitle>
                  <Trans>Add Affected Item</Trans>
                </ModalDrawerTitle>
              </ModalDrawerHeader>
              <ModalDrawerBody>
                <Hidden name="changeOrderId" value={changeOrderId} />
                <VStack spacing={4}>
                  {changeTypeField}
                  <InputControlled
                    name="readableId"
                    label={t`Part Number`}
                    helperText={
                      startsWithLetter(nextId)
                        ? t`Use ... to get the next part ID`
                        : undefined
                    }
                    value={nextId}
                    onChange={onIdChange}
                    isDisabled={loading}
                    isUppercase
                  />
                  <Input name="name" label={t`Name`} characterLimit={40} />
                  <Select
                    name="replenishmentSystem"
                    label={t`Replenishment System`}
                    termId="replenishment-system"
                    options={replenishmentOptions}
                    isOptional={false}
                  />
                  <Select
                    name="itemTrackingType"
                    label={t`Tracking Type`}
                    termId="item-tracking-type"
                    options={itemTrackingTypeOptions}
                  />
                </VStack>
              </ModalDrawerBody>
              {footer}
            </ValidatedForm>
          ) : (
            <ValidatedForm
              key="existing-item"
              validator={changeOrderAffectedItemValidator}
              method="post"
              action={path.to.changeOrderAffected(changeOrderId)}
              defaultValues={{
                changeOrderId,
                itemId: "",
                changeType,
                revision: ""
              }}
              fetcher={fetcher}
              className="flex flex-col h-full"
            >
              <ModalDrawerHeader>
                <ModalDrawerTitle>
                  <Trans>Add Affected Item</Trans>
                </ModalDrawerTitle>
              </ModalDrawerHeader>
              <ModalDrawerBody>
                <Hidden name="changeOrderId" value={changeOrderId} />
                <VStack spacing={4}>
                  {changeTypeField}
                  <Item
                    name="itemId"
                    label={t`Part`}
                    type="Part"
                    validItemTypes={["Part"]}
                    // Version = a new Draft make-method version (BoM/BoP edits),
                    // which only makes sense for a manufactured (Make) part — Buy
                    // parts have no BoM/BoP. Restrict the picker to Make parts for
                    // Version; other change types allow any Part.
                    replenishmentSystem={
                      changeType === "Version" ? "Make" : undefined
                    }
                    onChange={(o) =>
                      setSelectedItemId((o?.value as string) ?? "")
                    }
                    blacklist={blacklist}
                  />
                  {/* Mirror the make-method "New Version" warning: if the part's
                      current method is still an un-activated Draft, adding a
                      Version freezes it as Active (read-only) so production keeps
                      using it until this CO releases the new draft. */}
                  {willActivateDraft && (
                    <Alert variant="warning">
                      <LuTriangleAlert className="h-4 w-4" />
                      <AlertTitle>
                        <Trans>
                          This will set the current version of the make method
                          to Active, making it read-only.
                        </Trans>
                      </AlertTitle>
                      <AlertDescription>
                        <Trans>
                          Your changes go into a new draft version released with
                          this change order.
                        </Trans>
                      </AlertDescription>
                    </Alert>
                  )}
                  {/* A Revision mints a new revision item; let the user name the
                      revision (e.g. "A") instead of always auto-numbering.
                      Blank → the next revision is computed server-side. */}
                  {changeType === "Revision" && (
                    <Input
                      name="revision"
                      label={t`Revision`}
                      helperText={t`Leave blank to use the next revision automatically`}
                    />
                  )}
                </VStack>
              </ModalDrawerBody>
              {footer}
            </ValidatedForm>
          )}
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
}
