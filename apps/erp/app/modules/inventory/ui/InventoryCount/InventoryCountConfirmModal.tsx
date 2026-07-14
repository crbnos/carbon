import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  VStack
} from "@carbon/react";
import { Plural, Trans } from "@lingui/react/macro";
import { useEffect, useRef } from "react";
import { LuTriangleAlert } from "react-icons/lu";
import { useFetcher } from "react-router";
import { path } from "~/utils/path";

type InventoryCountConfirmModalProps = {
  inventoryCountId: string;
  summary: { uncounted: number; variances: number };
  isLoading?: boolean;
  onClose: () => void;
};

// Confirm (Draft -> Pending). Surfaces the row-level checks the user must
// acknowledge before the count is locked: uncounted rows (skipped at post) and
// non-zero variances. Counts are computed server-side so they reflect the whole
// count, not just the loaded page.
const InventoryCountConfirmModal = ({
  inventoryCountId,
  summary,
  isLoading = false,
  onClose
}: InventoryCountConfirmModalProps) => {
  const fetcher = useFetcher();

  // The confirm action redirects (no data returns to the fetcher), so close the
  // modal once the submission round-trip settles back to idle.
  const submitted = useRef(false);
  useEffect(() => {
    if (fetcher.state === "submitting") submitted.current = true;
    else if (fetcher.state === "idle" && submitted.current) {
      submitted.current = false;
      onClose();
    }
  }, [fetcher.state, onClose]);

  const uncounted = summary.uncounted;
  const variances = summary.variances;

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent>
        <ModalHeader>
          <ModalTitle>
            <Trans>Confirm Inventory Count</Trans>
          </ModalTitle>
        </ModalHeader>
        <ModalBody>
          <VStack spacing={4}>
            <p className="text-sm text-muted-foreground">
              <Trans>
                Confirming locks the counted quantities. Review the warnings
                below, then post the count to apply the adjustments.
              </Trans>
            </p>

            {isLoading ? (
              <p className="text-sm text-muted-foreground">
                <Trans>Recalculating…</Trans>
              </p>
            ) : (
              <>
                {uncounted > 0 && (
                  <Alert variant="warning">
                    <LuTriangleAlert className="h-4 w-4" />
                    <AlertTitle>
                      <Plural
                        value={uncounted}
                        one="# uncounted line"
                        other="# uncounted lines"
                      />
                    </AlertTitle>
                    <AlertDescription>
                      <Trans>
                        Uncounted lines are left unchanged at post — they are
                        not zeroed.
                      </Trans>
                    </AlertDescription>
                  </Alert>
                )}

                {variances > 0 && (
                  <p className="text-sm text-muted-foreground">
                    <Plural
                      value={variances}
                      one="# line differs from the expected quantity"
                      other="# lines differ from the expected quantity"
                    />
                  </p>
                )}
              </>
            )}
          </VStack>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={onClose}>
            <Trans>Cancel</Trans>
          </Button>
          <fetcher.Form
            method="post"
            action={path.to.inventoryCountConfirm(inventoryCountId)}
          >
            <Button
              type="submit"
              isDisabled={isLoading}
              isLoading={fetcher.state !== "idle"}
            >
              <Trans>Confirm Count</Trans>
            </Button>
          </fetcher.Form>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default InventoryCountConfirmModal;
