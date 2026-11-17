// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useAction } from "@carbon/query";
import {
  Button,
  DatePicker,
  FormControl,
  FormLabel,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  toast
} from "@carbon/react";
import { parseDate } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { useCompanyToday } from "~/hooks";
import type { action as deliveredAction } from "~/routes/x+/shipment+/$shipmentId.delivered";
import { path } from "~/utils/path";

type ShipmentDeliveredModalProps = {
  shipmentId: string;
  /** the day the shipment posted: the earliest delivery date */
  postingDate: string | null;
  /** the date already recorded, if any */
  deliveredDate: string | null;
  open: boolean;
  onClose: () => void;
};

/**
 * Mark Delivered: records the day the customer received the goods. The date
 * runs from the posting date to the company's today. Clear removes it.
 */
const ShipmentDeliveredModal = ({
  shipmentId,
  postingDate,
  deliveredDate,
  open,
  onClose
}: ShipmentDeliveredModalProps) => {
  const { t } = useLingui();
  const companyToday = useCompanyToday();
  // The user's pick; until they pick, the recorded date or today.
  const [picked, setPicked] = useState<string | null>(null);
  const value = picked ?? deliveredDate ?? companyToday;

  const fetcher = useAction<typeof deliveredAction>({
    onSuccess: () => {
      toast.success(t`Saved the delivery date`);
      setPicked(null);
      onClose();
    }
  });

  const submit = (date: string | null) =>
    fetcher.submit(
      { deliveredDate: date ?? "" },
      { method: "post", action: path.to.shipmentDelivered(shipmentId) }
    );

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setPicked(null);
          onClose();
        }
      }}
    >
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>
          <ModalTitle>
            <Trans>Mark Delivered</Trans>
          </ModalTitle>
        </ModalHeader>
        <ModalBody>
          <FormControl>
            <FormLabel>
              <Trans>Delivered on</Trans>
            </FormLabel>
            <DatePicker
              aria-label={t`Delivered on`}
              value={parseDate(value)}
              minValue={postingDate ? parseDate(postingDate) : undefined}
              maxValue={parseDate(companyToday)}
              onChange={(d) => d && setPicked(d.toString())}
            />
          </FormControl>
        </ModalBody>
        <ModalFooter>
          <HStack>
            {deliveredDate && (
              <Button
                variant="secondary"
                isDisabled={fetcher.isPending}
                onClick={() => submit(null)}
              >
                <Trans>Clear</Trans>
              </Button>
            )}
            <Button
              isLoading={fetcher.isPending}
              isDisabled={fetcher.isPending}
              onClick={() => submit(value)}
            >
              <Trans>Save</Trans>
            </Button>
          </HStack>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default ShipmentDeliveredModal;
