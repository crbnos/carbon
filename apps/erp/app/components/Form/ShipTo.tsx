// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { HStack, IconButton, useDisclosure } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { LuRefreshCcw } from "react-icons/lu";
import Confirm from "~/components/Modals/Confirm/Confirm";
import CustomerLocation from "./CustomerLocation";

/**
 * A sales document's delivery address, with the button that recalculates its
 * lines' taxes for it: a new ship-to can mean a new tax code.
 */
export default function ShipTo({
  name,
  customerId,
  recalculateTaxesAction,
  recalculateTaxesText,
  canRecalculateTaxes
}: {
  name: string;
  customerId?: string;
  recalculateTaxesAction: string;
  recalculateTaxesText: string;
  canRecalculateTaxes: boolean;
}) {
  const { t } = useLingui();
  const recalculateTaxesModal = useDisclosure();

  return (
    <HStack className="w-full items-end" spacing={1}>
      <CustomerLocation
        name={name}
        label={t`Ship To`}
        customer={customerId}
        isClearable
      />
      <IconButton
        type="button"
        variant="secondary"
        aria-label={t`Recalculate taxes`}
        title={t`Recalculate taxes`}
        icon={<LuRefreshCcw />}
        isDisabled={!canRecalculateTaxes}
        onClick={recalculateTaxesModal.onOpen}
      />
      <Confirm
        isOpen={recalculateTaxesModal.isOpen}
        action={recalculateTaxesAction}
        title={t`Recalculate taxes`}
        text={recalculateTaxesText}
        confirmText={t`Recalculate`}
        onCancel={recalculateTaxesModal.onClose}
        onSubmit={recalculateTaxesModal.onClose}
      />
    </HStack>
  );
}
