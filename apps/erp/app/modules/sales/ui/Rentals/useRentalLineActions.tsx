// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { Confirm, ConfirmDelete } from "~/components/Modals";
import { useCompanyToday, useCurrencyFormatter, usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import RentalAgreementReturnForm from "./RentalAgreementReturnForm";
import type { RentalAgreement, RentalAgreementLine } from "./types";

type LineActionKind = "deliver" | "return" | "sell" | "delete";

export type RentalLineActionState = {
  /** Shown at all: the line is in the state the action applies to. */
  canDeliver: boolean;
  canReturn: boolean;
  canSell: boolean;
  canDelete: boolean;
  /** Shown but refused for want of a permission. */
  deliverDisabled: boolean;
  returnDisabled: boolean;
  sellDisabled: boolean;
  deleteDisabled: boolean;
};

export const rentalUnitLabel = (line: RentalAgreementLine) =>
  [line.fixedAsset?.fixedAssetId, line.fixedAsset?.name]
    .filter(Boolean)
    .join(" · ") ||
  line.item?.readableIdWithRevision ||
  "";

/** The one home of a unit's lifecycle actions — Deliver, Return, Sell to
 *  Customer and Delete — so the units table, the explorer and the unit page
 *  offer the same actions under the same rules. Each opens its confirmation
 *  (or the return form) as page state and posts to the action route, which
 *  redirects back to the page it came from. */
export function useRentalLineActions(rentalAgreement: RentalAgreement) {
  const { t } = useLingui();
  const permissions = usePermissions();
  const today = useCompanyToday();
  const [pending, setPending] = useState<{
    kind: LineActionKind;
    line: RentalAgreementLine;
  } | null>(null);

  const id = rentalAgreement.id!;
  const isDraft = rentalAgreement.status === "Draft";
  const isActive = rentalAgreement.status === "Active";
  const canUpdate = permissions.can("update", "sales");
  // Selling bills a charge and drafts its invoice.
  const canSellPermission =
    canUpdate &&
    permissions.can("create", "sales") &&
    permissions.can("create", "invoicing");
  const purchaseOptionAmount = rentalAgreement.purchaseOptionAmount ?? 0;
  const currencyFormatter = useCurrencyFormatter({
    currency: rentalAgreement.currencyCode ?? undefined
  });

  const stateOf = (line: RentalAgreementLine): RentalLineActionState => {
    // Returned and Sold lines are finished; only a unit on rent comes back.
    const canReturn = isActive && line.status === "On Rent";
    return {
      canDeliver: isActive && line.status === "Pending",
      canReturn,
      // The purchase option ends a sales-type lease by sale.
      canSell:
        canReturn &&
        line.lessorClassification === "Sale" &&
        purchaseOptionAmount > 0,
      canDelete: isDraft,
      deliverDisabled: !canUpdate,
      returnDisabled: !canUpdate,
      sellDisabled: !canSellPermission,
      deleteDisabled: !permissions.can("delete", "sales")
    };
  };

  const open = (kind: LineActionKind, line: RentalAgreementLine) =>
    setPending({ kind, line });
  const close = () => setPending(null);

  const label = pending ? rentalUnitLabel(pending.line) : "";

  const modals = pending ? (
    <>
      {pending.kind === "deliver" && (
        <Confirm
          action={path.to.rentalAgreementLineDeliver(id, pending.line.id)}
          title={t`Deliver ${label}`}
          text={t`Mark the unit as delivered to the customer today. It goes on rent today; billing follows the agreement's start date and cycle.`}
          confirmText={t`Deliver`}
          confirmVariant="primary"
          onCancel={close}
          onSubmit={close}
        />
      )}
      {pending.kind === "sell" && (
        <Confirm
          action={path.to.rentalAgreementLineSell(id, pending.line.id)}
          title={t`Sell ${label} to the customer`}
          text={t`The customer exercises the purchase option. A purchase option charge of ${currencyFormatter.format(purchaseOptionAmount)} is billed today and its invoice drafted; posting that invoice transfers the unit and marks it Sold.`}
          confirmText={t`Sell to Customer`}
          confirmVariant="primary"
          onCancel={close}
          onSubmit={close}
        />
      )}
      {pending.kind === "delete" && (
        <ConfirmDelete
          action={path.to.deleteRentalAgreementLine(id, pending.line.id)}
          isOpen
          name={label}
          text={t`Are you sure you want to remove ${label} from this agreement?`}
          onCancel={close}
          onSubmit={close}
        />
      )}
      {pending.kind === "return" && (
        <RentalAgreementReturnForm
          action={path.to.rentalAgreementLineReturn(id, pending.line.id)}
          initialValues={{
            rentalAgreementLineId: pending.line.id,
            returnedAt: today,
            takeOutOfService: false,
            isSalesType: pending.line.lessorClassification === "Sale",
            residualDestination: undefined
          }}
          unitLabel={label}
          isSalesType={pending.line.lessorClassification === "Sale"}
          endDate={rentalAgreement.endDate}
          onClose={close}
        />
      )}
    </>
  ) : null;

  return { stateOf, open, modals };
}
