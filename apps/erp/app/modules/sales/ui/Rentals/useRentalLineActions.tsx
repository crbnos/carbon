// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { useSubmit } from "react-router";
import { Confirm, ConfirmDelete } from "~/components/Modals";
import { useCompanyToday, useCurrencyFormatter, usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import RentalAgreementReleaseForm from "./RentalAgreementReleaseForm";
import type { RentalAgreement, RentalAgreementLine } from "./types";

type RentalLineAction = "deliver" | "return" | "release" | "sell" | "delete";

export type RentalLineActionState = {
  /** Shown at all: the line is in the state the action applies to. */
  canDeliver: boolean;
  canReturn: boolean;
  canRelease: boolean;
  canSell: boolean;
  canDelete: boolean;
  /** Shown but refused for want of a permission. */
  deliverDisabled: boolean;
  returnDisabled: boolean;
  releaseDisabled: boolean;
  sellDisabled: boolean;
  deleteDisabled: boolean;
};

export const rentalUnitLabel = (line: RentalAgreementLine) =>
  [line.fixedAsset?.fixedAssetId, line.fixedAsset?.name]
    .filter(Boolean)
    .join(" · ") ||
  line.item?.readableIdWithRevision ||
  "";

/** The one home of a unit's lifecycle actions — Deliver, Return, Release
 *  unit, Sell to Customer and Delete — so the units table, the explorer and
 *  the unit page offer the same actions under the same rules. Deliver and
 *  Return open a rental shipment or receipt holding the unit; Release unit
 *  opens a date modal; Sell and Delete open their confirmation. Each posts to
 *  its action route, which redirects to the document or back to the page. */
export function useRentalLineActions(rentalAgreement: RentalAgreement) {
  const { t } = useLingui();
  const permissions = usePermissions();
  const submit = useSubmit();
  const today = useCompanyToday();
  const [pending, setPending] = useState<{
    action: RentalLineAction;
    line: RentalAgreementLine;
  } | null>(null);

  const id = rentalAgreement.id!;
  const isDraft = rentalAgreement.status === "Draft";
  const isActive = rentalAgreement.status === "Active";
  const canUpdate = permissions.can("update", "sales");
  // Deliver and Return draft an inventory document.
  const canMoveUnits = canUpdate && permissions.can("create", "inventory");
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
    // Returned and Sold lines are finished. A receipt also takes back a
    // Pending unit (spec Q8).
    const canReturn =
      isActive && (line.status === "On Rent" || line.status === "Pending");
    return {
      canDeliver: isActive && line.status === "Pending",
      canReturn,
      // A unit treated as a sale comes back on a receipt, with Return To
      // (plan decision P1).
      canRelease:
        isActive &&
        line.status === "Pending" &&
        line.lessorClassification !== "Sale",
      // The purchase option ends a sales-type lease by sale, at the end of
      // the term (the sell route refuses it earlier).
      canSell:
        isActive &&
        line.status === "On Rent" &&
        line.lessorClassification === "Sale" &&
        purchaseOptionAmount > 0 &&
        (!rentalAgreement.endDate || today >= rentalAgreement.endDate),
      canDelete: isDraft,
      deliverDisabled: !canMoveUnits,
      returnDisabled: !canMoveUnits,
      releaseDisabled: !canUpdate,
      sellDisabled: !canSellPermission,
      deleteDisabled: !permissions.can("delete", "sales")
    };
  };

  const open = (action: RentalLineAction, line: RentalAgreementLine) => {
    if (action === "deliver") {
      submit(new FormData(), {
        method: "post",
        action: path.to.rentalAgreementLineDeliver(id, line.id)
      });
      return;
    }
    if (action === "return") {
      submit(new FormData(), {
        method: "post",
        action: path.to.rentalAgreementLineReturn(id, line.id)
      });
      return;
    }
    setPending({ action, line });
  };
  const close = () => setPending(null);

  const label = pending ? rentalUnitLabel(pending.line) : "";

  const modals = pending ? (
    <>
      {pending.action === "sell" && (
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
      {pending.action === "delete" && (
        <ConfirmDelete
          action={path.to.deleteRentalAgreementLine(id, pending.line.id)}
          isOpen
          name={label}
          text={t`Are you sure you want to remove ${label} from this agreement?`}
          onCancel={close}
          onSubmit={close}
        />
      )}
      {pending.action === "release" && (
        <RentalAgreementReleaseForm
          action={path.to.rentalAgreementLineRelease(id, pending.line.id)}
          initialValues={{
            rentalAgreementLineId: pending.line.id,
            returnedAt: today
          }}
          unitLabel={label}
          onClose={close}
        />
      )}
    </>
  ) : null;

  return { stateOf, open, modals };
}
