// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalHeader,
  ModalTitle
} from "@carbon/react";
import { getLocalTimeZone } from "@internationalized/date";
import type { ActionFunctionArgs } from "react-router";
import { useNavigate } from "react-router";
import { useUser } from "~/hooks";
import { subsidiaryValidator } from "~/modules/settings/settings.models";
import { SubsidiaryCompanyForm } from "~/modules/settings/ui";
import { path } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(subsidiaryValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.settings.createSubsidiary(input.data);
  return respond(args.request, result).redirect(path.to.companies, {
    message: "Created company"
  });
}

export default function NewSubsidiaryRoute() {
  const navigate = useNavigate();
  const { company } = useUser();

  const initialValues = {
    parentCompanyId: company?.id ?? undefined,
    name: "",
    taxId: "",
    addressLine1: "",
    addressLine2: "",
    city: "",
    stateProvince: "",
    postalCode: "",
    countryCode: "",
    baseCurrencyCode: company?.baseCurrencyCode ?? "USD",
    timezone: getLocalTimeZone()
  };

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) navigate(path.to.companies);
      }}
    >
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Let's setup your new company</ModalTitle>
        </ModalHeader>
        <ModalBody>
          <SubsidiaryCompanyForm
            company={initialValues}
            parentCompanyId={company?.id ?? undefined}
          />
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}
