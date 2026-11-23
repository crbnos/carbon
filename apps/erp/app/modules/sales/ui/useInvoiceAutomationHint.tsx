// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import type { invoiceAutomations } from "../sales.models";

type InvoiceAutomation = (typeof invoiceAutomations)[number];

/** What the Invoicing setting in force does to an invoice once it is
 *  drafted, so a person knows whether they get to review it first. */
export function useInvoiceAutomationHint() {
  const { t } = useLingui();
  return (mode: InvoiceAutomation) => {
    switch (mode) {
      case "Draft Only":
        return t`Invoices are created as drafts. Nothing is posted or emailed until you do it.`;
      case "Post":
        return t`Invoices are posted as soon as they are created. Nothing is emailed.`;
      case "Post and Email":
        return t`Invoices are posted and emailed to the contact as soon as they are created.`;
      case "Post and Send via Stripe":
        return t`Invoices are posted and sent through Stripe as soon as they are created.`;
    }
  };
}
