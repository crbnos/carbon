// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, carbonFor, respond } from "@carbon/api/carbon.server";
import { originOf } from "@carbon/api/service-fn.server";
import { error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { flags } from "@carbon/env/flags.server";
import { validator } from "@carbon/form";
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalHeader,
  ModalTitle,
  useRouteDialog
} from "@carbon/react";
import { isInternalEmail, redirect } from "@carbon/utils";
import { Trans } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import {
  companyDetailsValidator,
  subsidiaryValidator
} from "~/modules/settings/settings.models";
import { getSubsidiary } from "~/modules/settings/settings.service";
import { SubsidiaryCompanyForm } from "~/modules/settings/ui";
import { path } from "~/utils/path";

const subsidiaryDetailsValidator = subsidiaryValidator.safeExtend({
  keepRecordCurrencies: companyDetailsValidator.shape.keepRecordCurrencies
});

export async function loader({ request, params }: LoaderFunctionArgs) {
  const auth = await requirePermissions(request, {
    view: "settings"
  });
  const { client, companyId, email } = auth;

  // Multi-company management: Carbon staff, and the companies the
  // `multi-company-management` flag turns it on for.
  if (
    !isInternalEmail(email) &&
    !(await flags.bool("multi-company-management", { companyId, email }))
  ) {
    throw redirect(path.to.settings);
  }

  const { id } = params;
  if (!id) throw notFound("Subsidiary not found");

  const [subsidiary, change] = await Promise.all([
    getSubsidiary(client, id),
    carbonFor(auth, originOf(request)).settings.getBaseCurrencyChange({
      companyId: id
    })
  ]);
  if (subsidiary.error) {
    throw redirect(
      path.to.companies,
      await flash(request, error(subsidiary.error, "Failed to load subsidiary"))
    );
  }

  return {
    subsidiary: subsidiary.data,
    // Unknown blockers keep the base currency read-only.
    baseCurrencyChange: change.error ? null : change.data
  };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(subsidiaryDetailsValidator).request(args, {
    params: ["id"]
  });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.settings.updateSubsidiaryDetails({
    ...input.data,
    id: input.params.id
  });
  return respond(args.request, result).redirect(path.to.companies, {
    message: "Updated subsidiary"
  });
}

export default function EditSubsidiaryRoute() {
  const { subsidiary, baseCurrencyChange } = useLoaderData<typeof loader>();
  const dialog = useRouteDialog(path.to.companies);

  const initialValues = {
    id: subsidiary.id,
    name: subsidiary.name ?? "",
    taxId: subsidiary.taxId ?? "",
    addressLine1: subsidiary.addressLine1 ?? "",
    addressLine2: subsidiary.addressLine2 ?? "",
    city: subsidiary.city ?? "",
    stateProvince: subsidiary.stateProvince ?? "",
    postalCode: subsidiary.postalCode ?? "",
    countryCode: subsidiary.countryCode ?? "",
    baseCurrencyCode: subsidiary.baseCurrencyCode ?? "",
    phone: subsidiary.phone ?? "",
    fax: subsidiary.fax ?? "",
    email: subsidiary.email ?? "",
    website: subsidiary.website ?? "",
    timezone: subsidiary.timezone ?? "UTC"
  };

  return (
    <Modal
      open={dialog.open}
      onOpenChange={(open) => {
        if (!open) dialog.close();
      }}
    >
      <ModalContent>
        <ModalHeader>
          <ModalTitle>
            <Trans>Edit company</Trans>
          </ModalTitle>
        </ModalHeader>
        <ModalBody>
          <SubsidiaryCompanyForm
            company={initialValues}
            parentCompanyId={subsidiary.parentCompanyId ?? ""}
            baseCurrencyChange={baseCurrencyChange}
          />
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}
