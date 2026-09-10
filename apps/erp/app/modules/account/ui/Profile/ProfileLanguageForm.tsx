import { ValidatedForm } from "@carbon/form";
import {
  getSortedLanguageSelectOptions,
  resolveLanguage
} from "@carbon/locale";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo } from "react";
import { Hidden, Select, Submit } from "~/components/Form";
import { path } from "~/utils/path";
import { accountLanguageValidator } from "../../account.models";

const ProfileLanguageForm = ({ locale }: { locale: string }) => {
  const { t } = useLingui();

  const options = useMemo(
    () => getSortedLanguageSelectOptions(locale),
    [locale]
  );

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
      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Language</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Select name="locale" label={t`Language`} options={options} />
          <Hidden name="intent" value="locale" />
        </CardContent>
        <CardFooter>
          <Submit>
            <Trans>Save</Trans>
          </Submit>
        </CardFooter>
      </Card>
    </ValidatedForm>
  );
};

export default ProfileLanguageForm;
