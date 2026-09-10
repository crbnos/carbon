import { ValidatedForm } from "@carbon/form";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useFetcher, useParams } from "react-router";
import { Hidden, Input, PhoneInput, Submit, TextArea } from "~/components/Form";
import { path } from "~/utils/path";
import { accountProfileValidator } from "../../account.models";
import type { Account } from "../../types";
import ProfilePhotoForm from "./ProfilePhotoForm";

type ProfileFormProps = {
  user: Account;
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
      defaultValues={{ ...user, phone: user.phone ?? undefined }}
      fetcher={fetcher}
      className="w-full"
    >
      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Profile</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 w-full">
            <VStack spacing={4}>
              <Input name="email" label={t`Email`} isDisabled />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
                <Input name="firstName" label={t`First Name`} />
                <Input name="lastName" label={t`Last Name`} />
              </div>
              <PhoneInput name="phone" label={t`Phone`} />
              <TextArea
                name="about"
                label={t`About`}
                characterLimit={160}
                className="my-2"
              />
              <Hidden name="intent" value="about" />
            </VStack>
            <ProfilePhotoForm user={user} />
          </div>
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

export default ProfileForm;
