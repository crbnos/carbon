import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { destroyAuthSession } from "@carbon/auth/session.server";
import { ValidatedForm, validationError, validator } from "@carbon/form";
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
import { Link, useLoaderData } from "@remix-run/react";
import { redirect, type ActionFunctionArgs } from "@vercel/remix";
import type { z } from "zod";
import { Hidden, Input, Submit } from "~/components/Form";
import { useOnboarding } from "~/hooks";
import {
  onboardingUserValidator,
  updatePublicAccount,
} from "~/modules/account";
import { getUser } from "~/modules/users/users.server";

export async function loader({ request }: ActionFunctionArgs) {
  const { client, userId } = await requirePermissions(request, {});

  const user = await getUser(client, userId);
  if (user.error || !user.data) {
    await destroyAuthSession(request);
  }

  return { user: user.data };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {});

  const validation = await validator(onboardingUserValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { firstName, lastName, next } = validation.data;

  const updateAccount = await updatePublicAccount(client, {
    id: userId,
    firstName,
    lastName,
    // about: about ?? "",
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
            {/* <TextArea name="about" label="About" /> */}
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
