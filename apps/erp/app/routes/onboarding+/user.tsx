// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { destroyAuthSession } from "@carbon/auth/session.server";
import { ValidatedForm, validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import {
  Button,
  CardFooter,
  CardHeader,
  CardTitle,
  HStack,
  PrefetchLink,
  VStack
} from "@carbon/react";
import { redirect } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import type { z } from "zod";
import {
  OnboardingCard,
  OnboardingCardContent,
  onboardingFormClassName
} from "~/components";
import { Hidden, Input, Submit } from "~/components/Form";
import { useOnboarding } from "~/hooks";
import {
  onboardingUserValidator,
  updatePublicAccount
} from "~/modules/account";
import { getUser } from "~/modules/users/users.server";
import { ONBOARDING_SHORTCUTS } from "~/shortcuts";
import { path } from "~/utils/path";

const logger = getLogger("erp", "user");

export async function loader({ request }: ActionFunctionArgs) {
  const { userId } = await requirePermissions(request, {
    // Onboarding acts on the user's own account: a portal-only user may still
    // create a company of their own.
    allowPortalAccounts: true
  });

  const user = await getUser(getCarbonServiceRole(), userId);
  if (user.error || !user.data) {
    await destroyAuthSession(request);
  }

  return { user: user.data };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId } = await requirePermissions(request, {
    // Onboarding acts on the user's own account: a portal-only user may still
    // create a company of their own.
    allowPortalAccounts: true
  });

  const validation = await validator(onboardingUserValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { firstName, lastName, next } = validation.data;

  const updateAccount = await updatePublicAccount(getCarbonServiceRole(), {
    id: userId,
    firstName,
    lastName
    // about: about ?? "",
  });

  if (updateAccount.error) {
    logger.error(updateAccount.error);
    throw new Error("Fatal: failed to update account");
  }

  throw redirect(next || path.to.onboarding.root);
}

export default function OnboardingUser() {
  const { t } = useLingui();
  const { user } = useLoaderData<typeof loader>();
  const { next, previous } = useOnboarding();

  const initialValues = {} as z.infer<typeof onboardingUserValidator>;

  if (
    user?.firstName &&
    user?.lastName &&
    user?.firstName !== "Carbon" &&
    user?.lastName !== "Admin"
  ) {
    initialValues.firstName = user?.firstName!;
    initialValues.lastName = user?.lastName!;
    // initialValues.about = user?.about!;
  }

  return (
    <OnboardingCard>
      <ValidatedForm
        autoComplete="off"
        validator={onboardingUserValidator}
        defaultValues={initialValues}
        method="post"
        className={onboardingFormClassName}
      >
        <CardHeader>
          <CardTitle>
            <Trans>Let's setup your account</Trans>
          </CardTitle>
        </CardHeader>
        <OnboardingCardContent>
          <Hidden name="next" value={next} />
          <VStack spacing={4}>
            <Input autoFocus name="firstName" label={t`First Name`} />
            <Input name="lastName" label={t`Last Name`} />
            {/* <TextArea name="about" label={t`About`} /> */}
          </VStack>
        </OnboardingCardContent>
        <CardFooter>
          <HStack>
            <Button
              variant="solid"
              isDisabled={!previous}
              size="md"
              asChild
              tabIndex={-1}
            >
              <PrefetchLink to={previous}>
                <Trans>Previous</Trans>
              </PrefetchLink>
            </Button>
            <Submit shortcut={ONBOARDING_SHORTCUTS.continue}>
              <Trans>Next</Trans>
            </Submit>
          </HStack>
        </CardFooter>
      </ValidatedForm>
    </OnboardingCard>
  );
}
