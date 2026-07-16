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
import { useEffect } from "react";
import { useFetcher, useNavigate } from "react-router";
import { Hidden, Item, Submit } from "~/components/Form";
import { path } from "~/utils/path";
import { changeOrderAffectedItemValidator } from "../../changeOrder.models";

// The "Add affected item" modal, opened from the sidebar's bottom button —
// mirrors the PO "Add Line Item" flow (bottom button → modal). On success it
// selects the new item by navigating to its URL (the middle pane is URL-driven).
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

  return (
    <ModalDrawerProvider type="modal">
      <ModalDrawer
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <ModalDrawerContent>
          <ValidatedForm
            validator={changeOrderAffectedItemValidator}
            method="post"
            action={path.to.changeOrderAffected(changeOrderId)}
            defaultValues={{ changeOrderId, itemId: "" }}
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
                <Item
                  name="itemId"
                  label={t`Part or Tool`}
                  type="Part"
                  validItemTypes={["Part", "Tool"]}
                  blacklist={blacklist}
                />
              </VStack>
            </ModalDrawerBody>
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
          </ValidatedForm>
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
}
