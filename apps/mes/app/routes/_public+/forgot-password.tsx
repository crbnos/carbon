import type { Result } from "@carbon/auth";
import {
  assertIsPost,
  error,
  forgotPasswordValidator,
  success,
} from "@carbon/auth";
import { sendMagicLink } from "@carbon/auth/auth.server";
import { getAuthSession } from "@carbon/auth/session.server";
import { getUserByEmail } from "@carbon/auth/users.server";
import {
  Input,
  Submit,
  ValidatedForm,
  validationError,
  validator,
} from "@carbon/form";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  VStack,
} from "@carbon/react";
import { Link, useActionData } from "@remix-run/react";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { LuAlertCircle, LuCheckCircle } from "react-icons/lu";

import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [
    {
      title: "Carbon Developers | Forgot Password",
    },
  ];
};

export async function loader({ request }: LoaderFunctionArgs) {
  const authSession = await getAuthSession(request);
  if (authSession) throw redirect(path.to.authenticatedRoot);
  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const validation = await validator(forgotPasswordValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { email } = validation.data;
  const user = await getUserByEmail(email);

  if (user.data && user.data.active) {
    const authSession = await sendMagicLink(email);

    if (!authSession) {
      return json(error(authSession, "Failed to send magic link"), {
        status: 500,
      });
    }
  }

  return json(success("Success"));
}

export default function ForgotPasswordRoute() {
  const actionData = useActionData<Result>();

  return (
    <div className="mx-auto flex w-full flex-col justify-center space-y-6 sm:w-[350px]">
      <div className="flex space-y-2 justify-center">
        <img
          src="/carbon-logo-dark.png"
          alt="Carbon Logo"
          className="block dark:hidden max-w-[100px] mb-3"
        />
        <img
          src="/carbon-logo-light.png"
          alt="Carbon Logo"
          className="hidden dark:block max-w-[100px] mb-3"
        />
      </div>

      {actionData?.success ? (
        <Alert variant="success" className="[&>svg]:left-8 [&>svg]:top-8 p-8">
          <LuCheckCircle className="w-4 h-4" />
          <AlertTitle>Success</AlertTitle>
          <AlertDescription>
            If you have an account, you should receive an email shortly with a
            link to log in.
          </AlertDescription>
        </Alert>
      ) : (
        <ValidatedForm validator={forgotPasswordValidator} method="post">
          <VStack spacing={4}>
            <p>Please enter your email address to search for your account.</p>
            {actionData?.success === false && (
              <Alert variant="destructive">
                <LuAlertCircle className="w-4 h-4" />
                <AlertTitle>{actionData?.message}</AlertTitle>
              </Alert>
            )}
            <Input name="email" label="Email" />
            <Submit size="lg" className="w-full">
              Reset Password
            </Submit>
            <Button variant="link" asChild className="w-full">
              <Link to={path.to.login}>Back to login</Link>
            </Button>
          </VStack>
        </ValidatedForm>
      )}
    </div>
  );
}
