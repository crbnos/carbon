import {
  Button,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  toast,
  VStack
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { useStore } from "@nanostores/react";
import { useEffect } from "react";
import { LuCircleCheck } from "react-icons/lu";
import { useFetcher } from "react-router";
import { path } from "~/utils/path";
import type {
  ChangeOrderChangeType,
  ChangeOrderItemDiff
} from "../../items.models";
import ChangeOrderDiffViewer from "./ChangeOrderDiffViewer";
import { releaseDialogOpenAtom } from "./releaseDialog.store";

// One affected item's read-only changes, shown in the release confirmation.
export type ReleaseChange = {
  id: string;
  label: string;
  // The item's description — rendered under the label by the overview Changes
  // rollup (ChangeOrderChanges); the release dialog doesn't populate it.
  name?: string | null;
  // Change type + draft make-method version, for the ChangeTypeBadge shown in
  // the overview Changes rollup.
  changeType: ChangeOrderChangeType;
  version?: number | null;
  diff?: ChangeOrderItemDiff;
};

// The Implementation → Done release control, rendered as a confirmation dialog
// (opened from the header button or the rail's Release section via
// releaseDialogOpenAtom). Releasing just activates each affected item's edited
// Draft make method as a new Active version and archives the prior one — the
// prior version is kept as history, so there is no merge/conflict step. The user
// reviews each item's changes, then confirms. Release is never a one-click action.
export default function ChangeOrderReleaseMerge({
  changeOrderId,
  status,
  changes
}: {
  changeOrderId: string;
  status: string | null;
  changes: ReleaseChange[];
}) {
  const fetcher = useFetcher<{ success?: boolean }>();
  const open = useStore(releaseDialogOpenAtom);

  useEffect(() => {
    const data = fetcher.data as
      | { error?: { message: string }; success?: boolean }
      | undefined;
    if (data?.error) toast.error(data.error.message);
    if (data?.success) releaseDialogOpenAtom.set(false);
  }, [fetcher.data]);

  // Close the dialog if this control unmounts (e.g. navigating away).
  useEffect(() => () => releaseDialogOpenAtom.set(false), []);

  if (status !== "Implementation") return null;

  const isSubmitting = fetcher.state !== "idle";

  return (
    <Modal open={open} onOpenChange={(v) => releaseDialogOpenAtom.set(v)}>
      <ModalContent className="flex h-[90vh] w-[90vw] flex-col p-0 sm:max-w-3xl">
        <ModalHeader className="px-6 pt-6">
          <ModalTitle>
            <Trans>Release change order</Trans>
          </ModalTitle>
          <ModalDescription>
            <Trans>
              Review each item's changes, then confirm — releasing can't be
              undone.
            </Trans>
          </ModalDescription>
        </ModalHeader>

        <ModalBody className="flex-1 overflow-y-auto px-6 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent">
          <VStack spacing={4} className="w-full">
            {changes.length === 0 ? (
              <span className="text-sm italic text-muted-foreground">
                <Trans>No affected items.</Trans>
              </span>
            ) : (
              changes.map((c) => (
                <VStack key={c.id} spacing={2} className="w-full min-w-0">
                  <h3
                    className="max-w-full truncate text-sm font-medium text-foreground"
                    title={c.label}
                  >
                    {c.label}
                  </h3>
                  <ChangeOrderDiffViewer diff={c.diff} />
                </VStack>
              ))
            )}
          </VStack>
        </ModalBody>

        <ModalFooter className="border-t border-border px-6 py-4">
          <HStack spacing={2} className="w-full justify-end">
            <Button
              variant="secondary"
              onClick={() => releaseDialogOpenAtom.set(false)}
              isDisabled={isSubmitting}
            >
              <Trans>Cancel</Trans>
            </Button>
            <fetcher.Form
              method="post"
              action={path.to.changeOrderStatus(changeOrderId)}
            >
              <input type="hidden" name="id" value={changeOrderId} />
              <input type="hidden" name="fromStatus" value="Implementation" />
              <input type="hidden" name="status" value="Done" />
              <Button
                type="submit"
                leftIcon={<LuCircleCheck />}
                variant="primary"
                isDisabled={isSubmitting}
                isLoading={isSubmitting}
              >
                <Trans>Confirm & release</Trans>
              </Button>
            </fetcher.Form>
          </HStack>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
