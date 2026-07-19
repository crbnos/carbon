import { ValidatedForm } from "@carbon/form";
import {
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
import { useFetcher, useNavigate } from "react-router";
import {
  Hidden,
  Input,
  InputControlled,
  Item,
  Select,
  Submit
} from "~/components/Form";
import { useNextItemId } from "~/hooks";
import { path } from "~/utils/path";
import {
  type ChangeOrderChangeType,
  changeOrderAffectedItemValidator,
  changeOrderChangeTypes,
  changeOrderNewPartValidator,
  itemReplenishmentSystems
} from "../../items.models";

// The "Add affected item" modal, opened from the sidebar's bottom button —
// mirrors the PO "Add Line Item" flow (bottom button → modal). On success it
// selects the new item by navigating to its URL (the middle pane is URL-driven).
//
// A single change-type Select drives the body: Version / Revision / Replacement
// Part pick an EXISTING Part/Tool; New Part reveals a create-new-part mini-form
// (mints a brand-new part under the change order). The two modes are separate
// ValidatedForms (each with its own validator); the Select carries `changeType`
// so the route action can tell them apart.
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
  const [itemType, setItemType] = useState<"Part" | "Tool">("Part");
  const { id: nextId, onIdChange, loading } = useNextItemId(itemType);

  const isNewPart = changeType === "New Part";

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
  const itemTypeOptions = [
    { label: t`Part`, value: "Part" },
    { label: t`Tool`, value: "Tool" }
  ];
  const replenishmentOptions = itemReplenishmentSystems.map((r) => ({
    label: r === "Buy" ? t`Buy` : r === "Make" ? t`Make` : t`Buy and Make`,
    value: r
  }));

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
            <ValidatedForm
              validator={changeOrderNewPartValidator}
              method="post"
              action={path.to.changeOrderAffected(changeOrderId)}
              defaultValues={{
                changeOrderId,
                readableId: nextId,
                name: "",
                itemType,
                replenishmentSystem: "Make"
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
                    value={nextId}
                    onChange={onIdChange}
                    isDisabled={loading}
                    isUppercase
                  />
                  <Input name="name" label={t`Name`} characterLimit={40} />
                  <Select
                    name="itemType"
                    label={t`Type`}
                    options={itemTypeOptions}
                    onChange={(o) =>
                      setItemType((o?.value as "Part" | "Tool") ?? "Part")
                    }
                  />
                  <Select
                    name="replenishmentSystem"
                    label={t`Replenishment System`}
                    termId="replenishment-system"
                    options={replenishmentOptions}
                  />
                </VStack>
              </ModalDrawerBody>
              {footer}
            </ValidatedForm>
          ) : (
            <ValidatedForm
              validator={changeOrderAffectedItemValidator}
              method="post"
              action={path.to.changeOrderAffected(changeOrderId)}
              defaultValues={{ changeOrderId, itemId: "", changeType }}
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
                    label={t`Part or Tool`}
                    type="Part"
                    validItemTypes={["Part", "Tool"]}
                    blacklist={blacklist}
                  />
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
