// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCarbon } from "@carbon/auth";
import { useAction } from "@carbon/query";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  toast,
  useMount,
  useRouteData
} from "@carbon/react";
import { getItemReadableId } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useRef, useState } from "react";
import { LuTriangleAlert } from "react-icons/lu";
import { useNavigation, useParams } from "react-router";
import { useUser } from "~/hooks";
import { useItems } from "~/stores";
import { path } from "~/utils/path";
import type { StockTransferLine } from "../../types";

const StockTransferPostModal = ({ onClose }: { onClose: () => void }) => {
  const { id } = useParams();
  if (!id) throw new Error("id not found");

  const { t } = useLingui();
  const [items] = useItems();
  const routeData = useRouteData<{
    stockTransferLines: StockTransferLine[];
  }>(path.to.stockTransfer(id));

  const navigation = useNavigation();

  const [validated, setValidated] = useState(false);
  const [validationErrors, setValidationErrors] = useState<
    {
      itemReadableId: string | null;
      pickedQuantity: number;
      pickedQuantityError: string;
    }[]
  >([]);

  const { carbon } = useCarbon();
  const {
    // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
    company: { id: companyId }
  } = useUser();

  const validateStockTransferTracking = async () => {
    const errors: {
      itemReadableId: string | null;
      pickedQuantity: number;
      pickedQuantityError: string;
    }[] = [];

    if (!carbon) {
      toast.error(t`Carbon client is not available`);
      return;
    }

    if (
      routeData?.stockTransferLines.length === 0 ||
      routeData?.stockTransferLines.every((line) => line.pickedQuantity === 0)
    ) {
      setValidationErrors([
        {
          itemReadableId: null,
          pickedQuantity: 0,
          pickedQuantityError: "Stock transfer is empty"
        }
      ]);
    }

    routeData?.stockTransferLines.forEach(async (line: StockTransferLine) => {
      if (line.requiresBatchTracking || line.requiresSerialTracking) {
        if (line.trackedEntityId) {
          const trackedEntity = await carbon
            .from("trackedEntity")
            .select("*")
            .eq("id", line.trackedEntityId)
            .single();
          if (trackedEntity.data?.status !== "Available") {
            errors.push({
              itemReadableId: getItemReadableId(items, line.itemId) ?? null,
              pickedQuantity: line.pickedQuantity ?? 0,
              pickedQuantityError: "Tracked entity is not available"
            });
          }
        }
      }
    });

    setValidationErrors(errors);
    setValidated(true);
  };

  useMount(() => {
    validateStockTransferTracking();
  });

  const fetcher = useAction<{}>({
    onSettled: () => {
      if (submitted.current) {
        onClose();
      }
    }
  });
  const submitted = useRef(false);
  return (
    <Modal
      open={true}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>
          <ModalTitle>
            <Trans>Complete Stock Transfer</Trans>
          </ModalTitle>
          <ModalDescription>
            <Trans>
              Are you sure you want to complete this stock transfer?
            </Trans>
          </ModalDescription>
        </ModalHeader>
        <ModalBody>
          {validationErrors.length > 0 && (
            <Alert variant="destructive">
              <LuTriangleAlert className="h-4 w-4" />
              <AlertTitle>
                <Trans>Missing Information</Trans>
              </AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-4 mt-2 space-y-1">
                  {validationErrors.map((error, index) => (
                    <li key={index} className="text-sm font-medium">
                      <span className="font-mono">{error.itemReadableId}</span>
                      <span className="text-muted-foreground ml-2">
                        {error.pickedQuantity}
                      </span>
                      <span className="block mt-0.5 text-red-500 font-normal">
                        {error.pickedQuantityError}
                      </span>
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
        </ModalBody>
        <ModalFooter>
          <HStack>
            <Button variant="solid" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <fetcher.Form
              action={path.to.stockTransferComplete(id)}
              method="post"
              onSubmit={() => {
                submitted.current = true;
              }}
            >
              <Button
                isLoading={fetcher.state !== "idle"}
                isDisabled={
                  fetcher.state !== "idle" ||
                  navigation.state !== "idle" ||
                  !validated ||
                  validationErrors.length > 0
                }
                type="submit"
              >
                Complete
              </Button>
            </fetcher.Form>
          </HStack>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default StockTransferPostModal;
