// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  CONTROLLED_ENVIRONMENT,
  MAGIC_LINK_SAME_BROWSER,
  SUPABASE_URL
} from "@carbon/auth";
import { isSignInBrowser } from "@carbon/auth/sign-in-browser.server";
import { Button, Heading } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { LoaderFunctionArgs } from "react-router";
import {
  Link,
  useLoaderData,
  useNavigate,
  useSearchParams
} from "react-router";

/**
 * Whether this page may offer to spend the link's token. With
 * MAGIC_LINK_SAME_BROWSER, only in the browser that asked for the email:
 * mail security sandboxes (Microsoft Defender) open the link in a real
 * browser and press its button, and the person then finds it used. Nothing
 * here spends anything — the token is only used by the button.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  return {
    sameBrowser: !MAGIC_LINK_SAME_BROWSER || (await isSignInBrowser(request))
  };
}

export default function ConfirmMagicLink() {
  const { t } = useLingui();
  const { sameBrowser } = useLoaderData<typeof loader>();
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const token = params.get("token");
  if (!token) {
    navigate("/");
    return null;
  }

  const getConfirmationURL = (token: string) => {
    return `${SUPABASE_URL}/auth/v1/verify?token=${token}&type=magiclink&redirect_to=${window?.location.origin}/callback`;
  };

  return (
    <>
      <div className="flex justify-center mb-8">
        <img
          src={CONTROLLED_ENVIRONMENT ? "/flag.png" : "/carbon-mark-light.svg"}
          className="w-24 dark:hidden"
          alt={t`Carbon Logo`}
        />
        <img
          src={CONTROLLED_ENVIRONMENT ? "/flag.png" : "/carbon-mark-dark.svg"}
          className="w-24 hidden dark:block"
          alt={t`Carbon Logo`}
        />
      </div>
      <div className="rounded-lg p-8 w-[380px]">
        <div className="flex flex-col items-center text-center">
          <Heading size="h3" className="tracking-tight">
            <Trans>Sign in to Carbon</Trans>
          </Heading>
          {sameBrowser ? (
            <>
              <p className="mt-2 text-muted-foreground tracking-tight text-sm text-balance">
                <Trans>You're one step away from your workspace.</Trans>
              </p>
              <Button
                size="lg"
                className="w-full mt-6"
                autoFocus
                onClick={() => {
                  window.location.href = getConfirmationURL(token);
                }}
              >
                <Trans>Let's Build</Trans>
              </Button>
            </>
          ) : (
            <>
              <p className="mt-2 text-muted-foreground tracking-tight text-sm text-balance">
                <Trans>
                  Open this link in the browser where you asked to sign in, or
                  enter the 6-digit code from the email there.
                </Trans>
              </p>
              <Button
                size="lg"
                variant="secondary"
                className="w-full mt-6"
                asChild
              >
                <Link to="/login">
                  <Trans>Sign in here instead</Trans>
                </Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
