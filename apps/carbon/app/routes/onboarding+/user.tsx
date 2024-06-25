import {
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  HStack,
  VStack,
} from "@carbon/react";
import {
  ValidatedForm,
  validationError,
  validator,
} from "@carbon/remix-validated-form";
import { redirect, type ActionFunctionArgs } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import type { z } from "zod";
import { Hidden, Input, Password, Submit } from "~/components/Form";
import { useOnboarding } from "~/hooks";
import { getSupabaseServiceRole } from "~/lib/supabase";
import {
  onboardingUserValidator,
  updatePublicAccount,
} from "~/modules/account";
import { getUser } from "~/modules/users/users.server";
import { requirePermissions } from "~/services/auth/auth.server";
import { destroyAuthSession } from "~/services/session.server";
import { assertIsPost } from "~/utils/http";

export async function loader({ request }: ActionFunctionArgs) {
  const { client, userId } = await requirePermissions(request, {
    update: "users",
  });

  const user = await getUser(client, userId);
  if (user.error || !user.data) {
    await destroyAuthSession(request);
  }

  return { user: user.data };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "users",
  });

  const validation = await validator(onboardingUserValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { firstName, lastName, email, password, next } = validation.data;

  const updatePassword =
    await getSupabaseServiceRole().auth.admin.updateUserById(userId, {
      email,
      password,
    });

  if (updatePassword.error) {
    console.error(updatePassword.error);
    throw new Error("Fatal: failed to update password");
  }

  const updateAccount = await updatePublicAccount(client, {
    id: userId,
    email,
    firstName,
    lastName,
    about: "",
  });

  if (updateAccount.error) {
    console.error(updateAccount.error);
    throw new Error("Fatal: failed to update account");
  }

  throw redirect(next);
}

export default function OnboardingUser() {
  const { user } = useLoaderData<typeof loader>();
  const { next, previous } = useOnboarding();

  const initialValues = {} as z.infer<typeof onboardingUserValidator>;

  if (user?.email && user.email !== "admin@carbon.us.org") {
    initialValues.email = user.email;
  }
  if (
    user?.firstName &&
    user?.lastName &&
    user?.firstName !== "Carbon" &&
    user?.lastName !== "Admin"
  ) {
    initialValues.firstName = user?.firstName!;
    initialValues.lastName = user?.lastName!;
  }

  return (
    <Card className="max-w-lg">
      <ValidatedForm
        autoComplete="off"
        validator={onboardingUserValidator}
        defaultValues={initialValues}
        method="post"
      >
        <CardHeader>
          <CardTitle>Let's setup your account</CardTitle>
        </CardHeader>
        <CardContent>
          <Hidden name="next" value={next} />
          <VStack spacing={4}>
            <Input autoFocus name="firstName" label="First Name" />
            <Input name="lastName" label="Last Name" />
            <Input autoComplete="off" name="email" label="Email" />
            <Password autoComplete="off" name="password" label="Password" />
          </VStack>
        </CardContent>
        <CardFooter>
          <HStack>
            <Button
              variant="solid"
              isDisabled={!previous}
              size="md"
              asChild
              tabIndex={-1}
            >
              <Link to={previous} prefetch="intent">
                Previous
              </Link>
            </Button>
            <Submit>Next</Submit>
          </HStack>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
}
