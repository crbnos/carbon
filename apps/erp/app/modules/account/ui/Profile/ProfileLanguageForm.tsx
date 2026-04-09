import { ValidatedForm } from "@carbon/form";
import { resolveLanguage } from "@carbon/locale";
import { VStack } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Hidden, Select, Submit } from "~/components/Form";
import { path } from "~/utils/path";
import { accountLanguageValidator } from "../../account.models";

const ProfileLanguageForm = ({ locale }: { locale: string }) => {
  const { t } = useLingui();

  return (
    <ValidatedForm
      method="post"
      action={path.to.profile}
      validator={accountLanguageValidator}
      defaultValues={{
        locale: resolveLanguage(locale)
      }}
      className="w-full"
    >
      <VStack spacing={4}>
        <Select
          name="locale"
          label={t`Language`}
          options={[
            {
              label: t`English`,
              value: "en"
            },
            { label: t`Polish`, value: "pl" }
          ]}
        />
        <p className="text-sm text-muted-foreground">
          <Trans>Choose your preferred language for the interface.</Trans>
        </p>
        <Hidden name="intent" value="locale" />
        <Submit>
          <Trans>Save</Trans>
        </Submit>
      </VStack>
    </ValidatedForm>
  );
};

export default ProfileLanguageForm;
