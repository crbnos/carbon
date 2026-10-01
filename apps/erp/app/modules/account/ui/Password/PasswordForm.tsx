// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
import { useRef, useState } from "react";
import { Password, Submit } from "~/components/Form";
import { path } from "~/utils/path";
import { accountPasswordValidator } from "../../account.models";

const PasswordForm = () => {
  const { t } = useLingui();
  const [passwordsMatch, setPasswordsMatch] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmPasswordRef = useRef<HTMLInputElement>(null);

  const onPasswordChange = () => {
    if (passwordRef.current && confirmPasswordRef.current) {
      setPasswordsMatch(
        passwordRef.current.value.length >= 6 &&
          confirmPasswordRef.current.value.length >= 6 &&
          passwordRef.current.value === confirmPasswordRef.current.value
      );
    }
  };

  return (
    <Card>
      <ValidatedForm
        method="post"
        action={path.to.accountPassword}
        validator={accountPasswordValidator}
      >
        <CardHeader>
          <CardTitle>
            <Trans>Update Password</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <VStack spacing={4} className="my-4 max-w-[440px]">
            <Password name="currentPassword" label={t`Current Password`} />
            <Password
              ref={passwordRef}
              onChange={onPasswordChange}
              name="password"
              label={t`New Password`}
            />
            <Password
              ref={confirmPasswordRef}
              onChange={onPasswordChange}
              name="confirmPassword"
              label={t`Confirm Password`}
            />
          </VStack>
        </CardContent>
        <CardFooter>
          <Submit isDisabled={!passwordsMatch} withBlocker={false}>
            Update Password
          </Submit>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
};

export default PasswordForm;
