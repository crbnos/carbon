// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Hidden,
  Input,
  PhoneInput,
  Submit,
  TextArea,
  ValidatedForm
} from "@carbon/form";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useFetcher } from "react-router";
import { accountProfileValidator } from "../models";
import type { Account } from "../types";
import type { ProfilePhotoFormProps } from "./ProfilePhotoForm";
import ProfilePhotoForm from "./ProfilePhotoForm";

type ProfileFormProps = {
  user: Account;
  /** Where the form posts: the account settings action or a person route. */
  action: string;
  /** Where the photo saves — always the account profile action. */
  photo: Omit<ProfilePhotoFormProps, "user">;
  /** `plain` drops the card, for a container that already frames the form. */
  variant?: "card" | "plain";
};

const ProfileForm = ({
  user,
  action,
  photo,
  variant = "card"
}: ProfileFormProps) => {
  const { t } = useLingui();
  const fetcher = useFetcher<{}>();

  const fields = (
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
      {/* Phones: the avatar heads the form as the identity header. */}
      <div className="contents max-md:block max-md:order-first max-md:justify-self-center">
        <ProfilePhotoForm user={user} {...photo} />
      </div>
    </div>
  );

  const save = (
    <Submit>
      <Trans>Save</Trans>
    </Submit>
  );

  return (
    <ValidatedForm
      method="post"
      action={action}
      validator={accountProfileValidator}
      defaultValues={{ ...user, phone: user.phone ?? undefined }}
      fetcher={fetcher}
      className="w-full"
    >
      {variant === "plain" ? (
        <VStack spacing={4}>
          {fields}
          <div>{save}</div>
        </VStack>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Profile</Trans>
            </CardTitle>
          </CardHeader>
          <CardContent>{fields}</CardContent>
          <CardFooter>{save}</CardFooter>
        </Card>
      )}
    </ValidatedForm>
  );
};

export default ProfileForm;
