// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle
} from "@carbon/react";
import { parseDate } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import type { FetcherWithComponents } from "react-router";
import { DatePicker, Submit } from "~/components/Form";
import { useCompanyToday } from "~/hooks";
import { inventoryCountPostValidator } from "~/modules/inventory/inventory.models";
import { path } from "~/utils/path";

type InventoryCountPostModalProps = {
  open?: boolean;
  inventoryCountId: string;
  // The page's post fetcher, so a refusal and the invalid lines reach the page.
  fetcher: FetcherWithComponents<unknown>;
  onClose: () => void;
};

/** Post a confirmed count on the day its variances are booked. */
const InventoryCountPostModal = ({
  open = true,
  inventoryCountId,
  fetcher,
  onClose
}: InventoryCountPostModalProps) => {
  const { t } = useLingui();
  const companyToday = useCompanyToday();

  return (
    <Modal
      open={open}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent>
        <ValidatedForm
          method="post"
          validator={inventoryCountPostValidator}
          fetcher={fetcher}
          action={path.to.inventoryCountPost(inventoryCountId)}
          defaultValues={{ postingDate: companyToday }}
        >
          <ModalHeader>
            <ModalTitle>
              <Trans>Post Count</Trans>
            </ModalTitle>
            <ModalDescription>
              <Trans>
                Each variance is booked as an inventory adjustment on the
                posting date. Posted is final.
              </Trans>
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <DatePicker
              name="postingDate"
              label={t`Posting Date`}
              maxValue={parseDate(companyToday)}
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Submit withBlocker={false}>
              <Trans>Post</Trans>
            </Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
};

export default InventoryCountPostModal;
