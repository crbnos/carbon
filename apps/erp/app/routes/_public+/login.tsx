import {
  assertIsPost,
  carbonClient,
  CarbonEdition,
  CLOUDFLARE_TURNSTILE_SECRET_KEY,
  CLOUDFLARE_TURNSTILE_SITE_KEY,
  CONTROLLED_ENVIRONMENT,
  error,
  magicLinkValidator,
} from "@carbon/auth";
import { sendMagicLink, verifyAuthSession } from "@carbon/auth/auth.server";
import { flash, getAuthSession } from "@carbon/auth/session.server";
import { getUserByEmail } from "@carbon/auth/users.server";
import { sendVerificationCode } from "@carbon/auth/verification.server";
import { Hidden, Input, Submit, ValidatedForm, validator } from "@carbon/form";
import { redis } from "@carbon/kv";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Heading,
  Separator,
  toast,
  VStack,
} from "@carbon/react";
import { ItarLoginDisclaimer, useMode } from "@carbon/remix";
import { Edition } from "@carbon/utils";
import { Turnstile } from "@marsidev/react-turnstile";
import { useFetcher, useSearchParams } from "@remix-run/react";
import { Ratelimit } from "@upstash/ratelimit";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { useEffect, useState } from "react";
import { LuCircleAlert } from "react-icons/lu";

import type { FormActionData, Result } from "~/types";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Login" }];
};

export const config = {
  runtime: "nodejs",
};

export async function loader({ request }: LoaderFunctionArgs) {
  const authSession = await getAuthSession(request);
  if (authSession && (await verifyAuthSession(authSession))) {
    throw redirect(path.to.authenticatedRoot);
  }

  return null;
}

const ratelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(5, "1 h"),
  analytics: true,
});

export async function action({ request }: ActionFunctionArgs): FormActionData {
  assertIsPost(request);
  const ip = request.headers.get("x-forwarded-for") ?? "127.0.0.1";
  const { success } = await ratelimit.limit(ip);

  if (!success) {
    return json(
      error(null, "Rate limit exceeded"),
      await flash(request, error(null, "Rate limit exceeded"))
    );
  }

  const validation = await validator(magicLinkValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return json(error(validation.error, "Invalid email address"));
  }

  const { email, turnstileToken } = validation.data;

  if (
    CarbonEdition === Edition.Cloud &&
    CLOUDFLARE_TURNSTILE_SITE_KEY !== "1x00000000000000000000AA"
  ) {
    const verifyResponse = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          secret: CLOUDFLARE_TURNSTILE_SECRET_KEY ?? "",
          response: turnstileToken ?? "",
          remoteip: ip,
        }),
      }
    );

    const verifyData = await verifyResponse.json();
    if (!verifyData.success) {
      return json(
        error(null, "Bot verification failed. Please try again."),
        await flash(
          request,
          error(null, "Bot verification failed. Please try again.")
        )
      );
    }
  }

  const user = await getUserByEmail(email);

  if (user.data && user.data.active) {
    const magicLink = await sendMagicLink(email);

    if (magicLink.error) {
      return json(
        error(magicLink, "Failed to send magic link"),
        await flash(request, error(magicLink, "Failed to send magic link"))
      );
    }
    return json({ success: true, mode: "login" });
  } else if (CarbonEdition === Edition.Enterprise) {
    // Enterprise edition does not support signup
    return json(
      { success: false, message: "User record not found" },
      await flash(request, error(null, "Failed to sign in"))
    );
  } else {
    // User doesn't exist, send verification code for signup
    const verificationSent = await sendVerificationCode(email);

    if (!verificationSent) {
      return json(
        error(null, "Failed to send verification code"),
        await flash(request, error(null, "Failed to send verification code"))
      );
    }

    return json({ success: true, mode: "signup", email });
  }
}

export default function LoginRoute() {
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get("redirectTo") ?? undefined;
  const [mode, setMode] = useState<"login" | "signup" | "verify">("login");
  const [signupEmail, setSignupEmail] = useState<string>("");
  const [turnstileToken, setTurnstileToken] = useState<string>("");

  const fetcher = useFetcher<Result & { mode?: string; email?: string }>();
  const theme = useMode();

  useEffect(() => {
    if (fetcher.data?.success && fetcher.data.mode) {
      if (fetcher.data.mode === "signup" && mode !== "verify") {
        setMode("verify");
        if (fetcher.data.email) {
          setSignupEmail(fetcher.data.email);
          // Redirect to verify route with email parameter
          const verifyUrl = `/verify?email=${encodeURIComponent(
            fetcher.data.email
          )}${
            redirectTo ? `&redirectTo=${encodeURIComponent(redirectTo)}` : ""
          }`;
          window.location.href = verifyUrl;
        }
      }
    }
  }, [fetcher.data, mode, redirectTo]);

  const onSignInWithGoogle = async () => {
    const { error } = await carbonClient.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/callback${
          redirectTo ? `?redirectTo=${redirectTo}` : ""
        }`,
      },
    });

    if (error) {
      toast.error(error.message);
    }
  };

  return (
    <>
      <div className="flex justify-center mb-4">
        <img
          src={CONTROLLED_ENVIRONMENT ? "/flag.png" : "/carbon-logo-mark.svg"}
          alt="Carbon Logo"
          className="w-36"
        />
      </div>
      <div className="rounded-lg md:bg-card md:border md:border-border md:shadow-lg p-8 w-[380px]">
        {fetcher.data?.success === true && fetcher.data?.mode === "login" ? (
          <>
            <VStack spacing={4} className="items-center justify-center">
              <Heading size="h3">Check your email</Heading>
              <p className="text-muted-foreground tracking-tight text-sm">
                We've sent you a magic link to sign in to your account.
              </p>
            </VStack>
          </>
        ) : mode === "verify" ? (
          <VStack spacing={4} className="items-center">
            <Heading size="h3">Verify your email</Heading>
            <p className="text-muted-foreground tracking-tight text-sm text-center">
              We've sent a verification code to {signupEmail}
            </p>
            <p className="text-muted-foreground tracking-tight text-xs text-center">
              Redirecting to verification page...
            </p>
            <Button
              type="button"
              variant="link"
              size="sm"
              onClick={() => {
                setMode("login");
                setSignupEmail("");
                // Reset fetcher data
                window.location.reload();
              }}
            >
              Use a different email
            </Button>
          </VStack>
        ) : (
          <ValidatedForm
            fetcher={fetcher}
            validator={magicLinkValidator}
            defaultValues={{ redirectTo }}
            method="post"
            action="/login"
          >
            <Hidden name="redirectTo" value={redirectTo} type="hidden" />
            <Hidden name="turnstileToken" value={turnstileToken} />
            <VStack spacing={4}>
              {fetcher.data?.success === false && fetcher.data?.message && (
                <Alert variant="destructive">
                  <LuCircleAlert className="w-4 h-4" />
                  <AlertTitle>Authentication Error</AlertTitle>
                  <AlertDescription>{fetcher.data?.message}</AlertDescription>
                </Alert>
              )}

              <Input name="email" label="" placeholder="Email Address" />

              <Submit
                isDisabled={
                  fetcher.state !== "idle" ||
                  (!!CLOUDFLARE_TURNSTILE_SITE_KEY && !turnstileToken)
                }
                isLoading={fetcher.state === "submitting"}
                size="lg"
                className="w-full"
                withBlocker={false}
              >
                Continue with Email
              </Submit>
              {!!CLOUDFLARE_TURNSTILE_SITE_KEY && (
                <div className="w-full flex justify-center">
                  <Turnstile
                    siteKey={CLOUDFLARE_TURNSTILE_SITE_KEY}
                    onSuccess={(token) => setTurnstileToken(token)}
                    onError={() => setTurnstileToken("")}
                    onExpire={() => setTurnstileToken("")}
                    options={{
                      theme: theme === "dark" ? "dark" : "light",
                    }}
                  />
                </div>
              )}
              <Separator />
              <Button
                type="button"
                size="lg"
                className="w-full"
                onClick={onSignInWithGoogle}
                isDisabled={fetcher.state !== "idle"}
                variant="secondary"
                leftIcon={<GoogleIcon />}
              >
                Continue with Google
              </Button>
            </VStack>
          </ValidatedForm>
        )}
      </div>

      <div className="flex flex-col gap-4 text-sm text-center text-balance text-muted-foreground w-[380px]">
        {mode !== "verify" &&
          fetcher.data?.success !== true &&
          CarbonEdition !== Edition.Enterprise && (
            <p>Login or create a new account</p>
          )}
        {CONTROLLED_ENVIRONMENT && <ItarLoginDisclaimer />}
        {CarbonEdition !== Edition.Community && (
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
        )}
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
