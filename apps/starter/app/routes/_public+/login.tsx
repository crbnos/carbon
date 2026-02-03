import {
  assertIsPost,
  carbonClient,
  error,
  magicLinkValidator,
  RATE_LIMIT,
  SUPABASE_AUTH_EXTERNAL_AZURE_CLIENT_ID,
  SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID
} from "@carbon/auth";
import { sendMagicLink, verifyAuthSession } from "@carbon/auth/auth.server";
import { flash, getAuthSession } from "@carbon/auth/session.server";
import { getUserByEmail } from "@carbon/auth/users.server";
import { Hidden, Input, Submit, ValidatedForm, validator } from "@carbon/form";
import { redis } from "@carbon/kv";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Heading,
  toast,
  VStack
} from "@carbon/react";
import { Ratelimit } from "@upstash/ratelimit";
import { LuCircleAlert } from "react-icons/lu";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction
} from "react-router";
import {
  data,
  redirect,
  useFetcher,
  useLoaderData,
  useSearchParams
} from "react-router";

import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Login" }];
};

export async function loader({ request }: LoaderFunctionArgs) {
  const authSession = await getAuthSession(request);
  if (authSession && (await verifyAuthSession(authSession))) {
    throw redirect(path.to.authenticatedRoot);
  }

  return {
    hasOutlookAuth: !!SUPABASE_AUTH_EXTERNAL_AZURE_CLIENT_ID,
    hasGoogleAuth: !!SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID
  };
}

const ratelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(RATE_LIMIT, "1 h"),
  analytics: true
});

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const ip = request.headers.get("x-forwarded-for") ?? "127.0.0.1";
  const { success } = await ratelimit.limit(ip);

  if (!success) {
    return data(
      error(null, "Rate limit exceeded"),
      await flash(request, error(null, "Rate limit exceeded"))
    );
  }

  const validation = await validator(magicLinkValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return error(validation.error, "Invalid email address");
  }

  const { email } = validation.data;
  const user = await getUserByEmail(email);

  if (user.data && user.data.active) {
    const magicLink = await sendMagicLink(email);

    if (!magicLink) {
      return data(
        error(magicLink, "Failed to send magic link"),
        await flash(request, error(magicLink, "Failed to send magic link"))
      );
    }
  } else {
    return data(
      error(user, "User record not found"),
      await flash(request, error(user.error, "User record not found"))
    );
  }

  return { success: true };
}

export default function LoginRoute() {
  const { hasOutlookAuth, hasGoogleAuth } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get("redirectTo") ?? undefined;

  const fetcher = useFetcher<
    { success: true } | { success: false; message: string }
  >();

  const onSignInWithGoogle = async () => {
    const { error } = await carbonClient.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/callback${
          redirectTo ? `?redirectTo=${redirectTo}` : ""
        }`
      }
    });

    if (error) {
      toast.error(error.message);
    }
  };

  const onSignInWithAzure = async () => {
    const { error } = await carbonClient.auth.signInWithOAuth({
      provider: "azure",
      options: {
        scopes: "email",
        redirectTo: `${window.location.origin}/callback${
          redirectTo ? `?redirectTo=${redirectTo}` : ""
        }`
      }
    });

    if (error) {
      toast.error(error.message);
    }
  };

  return (
    <>
      <div className="flex justify-center mb-4">
        <img src="/carbon-logo-mark.svg" alt="Carbon Logo" className="w-36" />
      </div>
      <div className="rounded-lg md:bg-card md:border md:border-border md:shadow-lg p-8 w-[380px]">
        {fetcher.data?.success === true ? (
          <>
            <VStack spacing={4} className="items-center justify-center">
              <Heading size="h3">Check your email</Heading>
              <p className="text-muted-foreground tracking-tight text-sm">
                We've sent you a magic link to sign in to your account.
              </p>
            </VStack>
          </>
        ) : (
          <ValidatedForm
            fetcher={fetcher}
            validator={magicLinkValidator}
            defaultValues={{ redirectTo }}
            method="post"
          >
            <Hidden name="redirectTo" value={redirectTo} type="hidden" />
            <VStack spacing={2}>
              {fetcher.data?.success === false && fetcher.data?.message && (
                <Alert variant="destructive">
                  <LuCircleAlert className="w-4 h-4" />
                  <AlertTitle>Authentication Error</AlertTitle>
                  <AlertDescription>{fetcher.data?.message}</AlertDescription>
                </Alert>
              )}

              <Input name="email" label="" placeholder="Email Address" />

              <Submit
                isDisabled={fetcher.state !== "idle"}
                isLoading={fetcher.state === "submitting"}
                size="lg"
                className="w-full"
                withBlocker={false}
              >
                Sign in with Email
              </Submit>

              {hasGoogleAuth && (
                <Button
                  type="button"
                  size="lg"
                  className="w-full"
                  onClick={onSignInWithGoogle}
                  isDisabled={fetcher.state !== "idle"}
                  variant="secondary"
                  leftIcon={<GoogleIcon />}
                >
                  Sign in with Google
                </Button>
              )}
              {hasOutlookAuth && (
                <Button
                  type="button"
                  size="lg"
                  className="w-full"
                  onClick={onSignInWithAzure}
                  isDisabled={fetcher.state !== "idle"}
                  variant="secondary"
                  leftIcon={<OutlookIcon className="size-6" />}
                >
                  Sign in with Outlook
                </Button>
              )}
            </VStack>
          </ValidatedForm>
        )}
      </div>
      <div className="text-sm text-center text-balance text-muted-foreground w-[380px] mt-4">
        <p>
          By signing in, you agree to the{" "}
          <a
            href="https://carbon.ms/terms"
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            Terms of Service
          </a>{" "}
          and{" "}
          <a
            href="https://carbon.ms/privacy"
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            Privacy Policy.
          </a>
        </p>
      </div>
    </>
  );
}

function GoogleIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      height="16"
      strokeLinejoin="round"
      viewBox="0 0 16 16"
      width="16"
      {...props}
    >
      <path
        d="M8.15991 6.54543V9.64362H12.4654C12.2763 10.64 11.709 11.4837 10.8581 12.0509L13.4544 14.0655C14.9671 12.6692 15.8399 10.6182 15.8399 8.18188C15.8399 7.61461 15.789 7.06911 15.6944 6.54552L8.15991 6.54543Z"
        fill="#4285F4"
      ></path>
      <path
        d="M3.6764 9.52268L3.09083 9.97093L1.01807 11.5855C2.33443 14.1963 5.03241 16 8.15966 16C10.3196 16 12.1305 15.2873 13.4542 14.0655L10.8578 12.0509C10.1451 12.5309 9.23598 12.8219 8.15966 12.8219C6.07967 12.8219 4.31245 11.4182 3.67967 9.5273L3.6764 9.52268Z"
        fill="#34A853"
      ></path>
      <path
        d="M1.01803 4.41455C0.472607 5.49087 0.159912 6.70543 0.159912 7.99995C0.159912 9.29447 0.472607 10.509 1.01803 11.5854C1.01803 11.5926 3.6799 9.51991 3.6799 9.51991C3.5199 9.03991 3.42532 8.53085 3.42532 7.99987C3.42532 7.46889 3.5199 6.95983 3.6799 6.47983L1.01803 4.41455Z"
        fill="#FBBC05"
      ></path>
      <path
        d="M8.15982 3.18545C9.33802 3.18545 10.3853 3.59271 11.2216 4.37818L13.5125 2.0873C12.1234 0.792777 10.3199 0 8.15982 0C5.03257 0 2.33443 1.79636 1.01807 4.41455L3.67985 6.48001C4.31254 4.58908 6.07983 3.18545 8.15982 3.18545Z"
        fill="#EA4335"
      ></path>
    </svg>
  );
}

function OutlookIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      height="24"
      width="24"
      viewBox="-274.66275 -425.834 2380.4105 2555.004"
      {...props}
    >
      <path
        d="M1831.083 894.25a40.879 40.879 0 00-19.503-35.131h-.213l-.767-.426-634.492-375.585a86.175 86.175 0 00-8.517-5.067 85.17 85.17 0 00-78.098 0 86.37 86.37 0 00-8.517 5.067l-634.49 375.585-.766.426c-19.392 12.059-25.337 37.556-13.278 56.948a41.346 41.346 0 0014.257 13.868l634.492 375.585a95.617 95.617 0 008.517 5.068 85.17 85.17 0 0078.098 0 95.52 95.52 0 008.517-5.068l634.492-375.585a40.84 40.84 0 0020.268-35.685z"
        fill="#0A2767"
      />
      <path
        d="M520.453 643.477h416.38v381.674h-416.38zM1745.917 255.5V80.908c1-43.652-33.552-79.862-77.203-80.908H588.204C544.552 1.046 510 37.256 511 80.908V255.5l638.75 170.333z"
        fill="#0364B8"
      />
      <path d="M511 255.5h425.833v383.25H511z" fill="#0078D4" />
      <path
        d="M1362.667 255.5H936.833v383.25L1362.667 1022h383.25V638.75z"
        fill="#28A8EA"
      />
      <path d="M936.833 638.75h425.833V1022H936.833z" fill="#0078D4" />
      <path d="M936.833 1022h425.833v383.25H936.833z" fill="#0364B8" />
      <path d="M520.453 1025.151h416.38v346.969h-416.38z" fill="#14447D" />
      <path d="M1362.667 1022h383.25v383.25h-383.25z" fill="#0078D4" />
      <linearGradient
        gradientTransform="matrix(1 0 0 -1 0 1705.333)"
        y2="1.998"
        x2="1128.458"
        y1="811.083"
        x1="1128.458"
        gradientUnits="userSpaceOnUse"
        id="a"
      >
        <stop offset="0" stopColor="#35b8f1" />
        <stop offset="1" stopColor="#28a8ea" />
      </linearGradient>
      <path
        d="M1811.58 927.593l-.809.426-634.492 356.848c-2.768 1.703-5.578 3.321-8.517 4.769a88.437 88.437 0 01-34.407 8.517l-34.663-20.27a86.706 86.706 0 01-8.517-4.897L447.167 906.003h-.298l-21.036-11.753v722.384c.328 48.196 39.653 87.006 87.849 86.7h1230.914c.724 0 1.363-.341 2.129-.341a107.79 107.79 0 0029.808-6.217 86.066 86.066 0 0011.966-6.217c2.853-1.618 7.75-5.152 7.75-5.152a85.974 85.974 0 0034.833-68.772V894.25a38.323 38.323 0 01-19.502 33.343z"
        fill="url(#a)"
      />
      <path
        d="M1797.017 891.397v44.287l-663.448 456.791-686.87-486.174a.426.426 0 00-.426-.426l-63.023-37.899v-31.938l25.976-.426 54.932 31.512 1.277.426 4.684 2.981s645.563 368.346 647.267 369.197l24.698 14.478c2.129-.852 4.258-1.703 6.813-2.555 1.278-.852 640.879-360.681 640.879-360.681z"
        fill="#0A2767"
        opacity=".5"
      />
      <path
        d="M1811.58 927.593l-.809.468-634.492 356.848c-2.768 1.703-5.578 3.321-8.517 4.769a88.96 88.96 0 01-78.098 0 96.578 96.578 0 01-8.517-4.769l-634.49-356.848-.766-.468a38.326 38.326 0 01-20.057-33.343v722.384c.305 48.188 39.616 87.004 87.803 86.7h1229.64c48.188.307 87.5-38.509 87.807-86.696 0-.001 0 0 0 0V894.25a38.33 38.33 0 01-19.504 33.343z"
        fill="#1490DF"
      />
      <path
        d="M1185.52 1279.629l-9.496 5.323a92.806 92.806 0 01-8.517 4.812 88.173 88.173 0 01-33.47 8.857l241.405 285.479 421.107 101.476a86.785 86.785 0 0026.7-33.343z"
        opacity=".1"
      />
      <path
        d="M1228.529 1255.442l-52.505 29.51a92.806 92.806 0 01-8.517 4.812 88.173 88.173 0 01-33.47 8.857l113.101 311.838 549.538 74.989a86.104 86.104 0 0034.407-68.815v-9.326z"
        opacity=".05"
      />
      <path
        d="M514.833 1703.333h1228.316a88.316 88.316 0 0052.59-17.033l-697.089-408.331a86.706 86.706 0 01-8.517-4.897L447.125 906.088h-.298l-20.993-11.838v719.914c-.048 49.2 39.798 89.122 88.999 89.169-.001 0-.001 0 0 0z"
        fill="#28A8EA"
      />
      <path
        d="M1022 418.722v908.303c-.076 31.846-19.44 60.471-48.971 72.392a73.382 73.382 0 01-28.957 5.962H425.833V383.25H511v-42.583h433.073c43.019.163 77.834 35.035 77.927 78.055z"
        opacity=".1"
      />
      <path
        d="M979.417 461.305v908.302a69.36 69.36 0 01-6.388 29.808c-11.826 29.149-40.083 48.273-71.54 48.417H425.833V383.25h475.656a71.493 71.493 0 0135.344 8.943c26.104 13.151 42.574 39.883 42.584 69.112z"
        opacity=".2"
      />
      <path
        d="M979.417 461.305v823.136c-.208 43-34.928 77.853-77.927 78.225H425.833V383.25h475.656a71.493 71.493 0 0135.344 8.943c26.104 13.151 42.574 39.883 42.584 69.112z"
        opacity=".2"
      />
      <path
        d="M936.833 461.305v823.136c-.046 43.067-34.861 78.015-77.927 78.225H425.833V383.25h433.072c43.062.023 77.951 34.951 77.927 78.013a.589.589 0 01.001.042z"
        opacity=".2"
      />
      <linearGradient
        gradientTransform="matrix(1 0 0 -1 0 1705.333)"
        y2="324.259"
        x2="774.086"
        y1="1383.074"
        x1="162.747"
        gradientUnits="userSpaceOnUse"
        id="b"
      >
        <stop offset="0" stopColor="#1784d9" />
        <stop offset=".5" stopColor="#107ad5" />
        <stop offset="1" stopColor="#0a63c9" />
      </linearGradient>
      <path
        d="M78.055 383.25h780.723c43.109 0 78.055 34.947 78.055 78.055v780.723c0 43.109-34.946 78.055-78.055 78.055H78.055c-43.109 0-78.055-34.947-78.055-78.055V461.305c0-43.108 34.947-78.055 78.055-78.055z"
        fill="url(#b)"
      />
      <path
        d="M243.96 710.631a227.05 227.05 0 0189.17-98.495 269.56 269.56 0 01141.675-35.515 250.91 250.91 0 01131.114 33.683 225.014 225.014 0 0186.742 94.109 303.751 303.751 0 0130.405 138.396 320.567 320.567 0 01-31.299 144.783 230.37 230.37 0 01-89.425 97.388 260.864 260.864 0 01-136.011 34.578 256.355 256.355 0 01-134.01-34.067 228.497 228.497 0 01-87.892-94.28 296.507 296.507 0 01-30.745-136.735 329.29 329.29 0 0130.276-143.845zm95.046 231.227a147.386 147.386 0 0050.163 64.812 131.028 131.028 0 0078.353 23.591 137.244 137.244 0 0083.634-24.358 141.156 141.156 0 0048.715-64.812 251.594 251.594 0 0015.543-90.404 275.198 275.198 0 00-14.649-91.554 144.775 144.775 0 00-47.182-67.537 129.58 129.58 0 00-82.91-25.55 135.202 135.202 0 00-80.184 23.804 148.626 148.626 0 00-51.1 65.365 259.759 259.759 0 00-.341 186.728z"
        fill="#FFF"
      />
      <path d="M1362.667 255.5h383.25v383.25h-383.25z" fill="#50D9FF" />
    </svg>
  );
}
