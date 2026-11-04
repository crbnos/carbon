// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { toastServiceError } from "@carbon/query";
import { useEffect } from "react";
import { useFetcher } from "react-router";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import RentalContactsEditor, {
  type RentalContactsValue
} from "./RentalContactsEditor";
import type { RentalAgreement, RentalAgreementContact } from "./types";

type RentalAgreementContactsProps = {
  rentalAgreement: RentalAgreement;
  contacts: RentalAgreementContact[];
};

/** The agreement page's contacts table. Every change saves the whole list,
 *  through the same writer as setup step 1. */
const RentalAgreementContacts = ({
  rentalAgreement,
  contacts
}: RentalAgreementContactsProps) => {
  const permissions = usePermissions();
  const fetcher = useFetcher<{ error: { message: string } | null }>();

  useEffect(() => {
    if (fetcher.data?.error) toastServiceError(fetcher.data);
  }, [fetcher.data]);

  const saved: RentalContactsValue = {
    primaryId: rentalAgreement.customerContactId ?? undefined,
    contacts: contacts.map((row) => ({
      customerContactId: row.customerContactId,
      role: row.role
    }))
  };
  // Shown as sent until the page reloads with what was saved.
  const pending = fetcher.formData?.get("value");
  const value: RentalContactsValue =
    typeof pending === "string" ? JSON.parse(pending) : saved;

  const isReadOnly =
    !(
      rentalAgreement.status === "Draft" || rentalAgreement.status === "Active"
    ) || !permissions.can("update", "sales");

  const save = (next: RentalContactsValue) => {
    const formData = new FormData();
    formData.append("value", JSON.stringify(next));
    formData.append("primaryId", next.primaryId ?? "");
    formData.append("contacts", JSON.stringify(next.contacts));
    fetcher.submit(formData, {
      method: "post",
      action: path.to.rentalAgreementContacts(rentalAgreement.id!)
    });
  };

  return (
    <RentalContactsEditor
      customerId={rentalAgreement.customerId ?? ""}
      value={value}
      onChange={save}
      isReadOnly={isReadOnly}
    />
  );
};

export default RentalAgreementContacts;
