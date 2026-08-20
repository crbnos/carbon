import { ValidatedForm } from "@carbon/form";
import { VStack } from "@carbon/react";
import type { z } from "zod";
import { Currency, Input, Select, Submit, Timezone } from "~/components/Form";
import AddressAutocomplete from "~/components/Form/AddressAutocomplete";
import { useRouteData } from "~/hooks";
import { type Company, subsidiaryValidator } from "~/modules/settings";
import { path } from "~/utils/path";

type CompanyFormProps = {
  company: z.infer<typeof subsidiaryValidator>;
  parentCompanyId: string;
};

const SubsidiaryCompanyForm = ({
  company,
  parentCompanyId
}: CompanyFormProps) => {
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
            <Currency name="baseCurrencyCode" label="Base Currency" />
          </div>
          <Submit withBlocker={false}>Save</Submit>
        </VStack>
      </ValidatedForm>
    </>
  );
};

export default SubsidiaryCompanyForm;
