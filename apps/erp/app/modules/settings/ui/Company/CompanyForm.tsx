import { useControlField, ValidatedForm } from "@carbon/form";
import { VStack } from "@carbon/react";
import { isEoriCountry, isRegistrationNumberCountry } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { z } from "zod";
import { Currency, Hidden, Input, PhoneInput, Submit } from "~/components/Form";
import AddressAutocomplete from "~/components/Form/AddressAutocomplete";
import { companyValidator } from "~/modules/settings";
import { path } from "~/utils/path";

type CompanyFormProps = {
  company: z.infer<typeof companyValidator>;
};

// Reads the live countryCode so picking a new country in AddressAutocomplete
// shows or hides these immediately, rather than waiting for a save + reload.
const CountrySpecificFields = () => {
  const { t } = useLingui();
  const [countryCode] = useControlField<string>("countryCode");

  return (
    <>
      {isEoriCountry(countryCode) && (
        <Input
          name="eori"
          label={t`EORI`}
          placeholder={t`e.g. GB123456789000`}
        />
      )}
      {isRegistrationNumberCountry(countryCode) && (
        <Input
          name="registrationNumber"
          label={t`Registration Number`}
          placeholder={t`e.g. 01234567`}
        />
      )}
    </>
  );
};

const CompanyForm = ({ company }: CompanyFormProps) => {
  const { t } = useLingui();
  return (
    <>
      <ValidatedForm
        method="post"
        action={path.to.company}
        validator={companyValidator}
        defaultValues={company}
      >
        <Hidden name="intent" value="about" />

        <VStack spacing={4}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
            <Input
              name="name"
              label={t`Company Name`}
              placeholder={t`e.g. Acme Manufacturing`}
            />
            <Input
              name="taxId"
              label={t`Tax ID`}
              placeholder={t`e.g. 12-3456789`}
            />
            <Input
              name="vatNumber"
              label={t`VAT Number`}
              placeholder={t`e.g. GB123456789`}
            />
            <CountrySpecificFields />
            <AddressAutocomplete variant="grid" />
            <Currency
              name="baseCurrencyCode"
              label={t`Base Currency`}
              disabled={true}
            />
            <PhoneInput
              name="phone"
              label={t`Phone Number`}
              placeholder={t`e.g. +1 555 123 4567`}
            />
            <PhoneInput
              name="fax"
              label={t`Fax Number`}
              placeholder={t`e.g. +1 555 123 4568`}
            />
            <Input
              name="email"
              label={t`Email`}
              placeholder="info@example.com"
            />
            <Input
              name="website"
              label={t`Website`}
              placeholder="https://www.example.com"
            />
          </div>
          <Submit>
            <Trans>Save</Trans>
          </Submit>
        </VStack>
      </ValidatedForm>
    </>
  );
};

export default CompanyForm;
