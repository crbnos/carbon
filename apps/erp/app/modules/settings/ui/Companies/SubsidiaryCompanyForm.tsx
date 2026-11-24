// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import { VStack } from "@carbon/react";
import type { z } from "zod";
import { Currency, Input, Select, Submit, Timezone } from "~/components/Form";
import AddressAutocomplete from "~/components/Form/AddressAutocomplete";
import { useRouteData } from "~/hooks";
import { subsidiaryValidator } from "~/modules/settings/settings.models";
import type { BaseCurrencyChange, Company } from "~/modules/settings/types";
import { path } from "~/utils/path";
import { BaseCurrencyField } from "../Company/BaseCurrencyField";

type CompanyFormProps = {
  company: z.infer<typeof subsidiaryValidator>;
  parentCompanyId: string;
  baseCurrencyChange?: BaseCurrencyChange | null;
};

const SubsidiaryCompanyForm = ({
  company,
  parentCompanyId,
  baseCurrencyChange
}: CompanyFormProps) => {
  const isEditing = company.id !== undefined;
  const routeData = useRouteData<{ companies: Company[] }>(path.to.companies);
  const parentCompanyOptions =
    routeData?.companies
      .filter((c) => !c.isEliminationEntity)
      .map((c) => ({
        value: c.id ?? "",
        label: c.name ?? ""
      })) ?? [];

  return (
    <>
      <ValidatedForm
        method="post"
        validator={subsidiaryValidator}
        defaultValues={{ ...company, parentCompanyId }}
      >
        <VStack spacing={4}>
          <div className="flex flex-col gap-4 w-full">
            <Select
              name="parentCompanyId"
              label="Parent Company"
              options={parentCompanyOptions}
            />
            <Input name="name" label="Company Name" />
            <AddressAutocomplete variant="grid" />
            <Timezone name="timezone" label="Timezone" />
            {isEditing ? (
              <BaseCurrencyField change={baseCurrencyChange} />
            ) : (
              <Currency name="baseCurrencyCode" label="Base Currency" />
            )}
          </div>
          <Submit withBlocker={false}>Save</Submit>
        </VStack>
      </ValidatedForm>
    </>
  );
};

export default SubsidiaryCompanyForm;
