import { ValidatedForm } from "@carbon/form";
import { VStack } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useFetcher, useParams } from "react-router";
import { Hidden, Input, Submit, TextArea } from "~/components/Form";
import type { User } from "~/modules/users/types";
import { path } from "~/utils/path";
import { accountProfileValidator } from "../../account.models";

type ProfileFormProps = {
  user: User;
};

const ProfileForm = ({ user }: ProfileFormProps) => {
  const { t } = useLingui();
  const { personId } = useParams();
  const isSelf = !personId;
  const fetcher = useFetcher<{}>();

  return (
    <ValidatedForm
      method="post"
      action={isSelf ? path.to.profile : path.to.person(personId)}
      validator={accountProfileValidator}
      defaultValues={user}
      fetcher={fetcher}
      className="w-full"
    >
      <VStack spacing={4}>
        <Input name="email" label={t`Email`} isDisabled />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
          <Input name="firstName" label={t`First Name`} />
          <Input name="lastName" label={t`Last Name`} />
        </div>
        <TextArea
          name="about"
          label={t`About`}
          characterLimit={160}
          className="my-2"
        />
        <Hidden name="intent" value="about" />
        <Submit>
          <Trans>Save</Trans>
        </Submit>
      </VStack>
    </ValidatedForm>
  );
};

export default ProfileForm;
