import { CONTROLLED_ENVIRONMENT } from "@carbon/auth";
import { getAuthSession } from "@carbon/auth/session.server";
import { Button, Heading, VStack } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { redirect } from "react-router";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Finish setup" }];
};

// A terminal screen for an authenticated user who has no company yet — MES does
// not host the onboarding wizard, so it points them at ERP onboarding rather
// than looping them through an ERP `/x` route that also requires a company.
// Unauthenticated visitors go to login; company-less authed users see the
// message (this route is NOT under the `x+` company guard).
export async function loader({ request }: LoaderFunctionArgs) {
  const authSession = await getAuthSession(request);
  if (!authSession) {
    throw redirect(path.to.login);
  }
  return {};
}

export default function SetupRequiredRoute() {
  const { t } = useLingui();

  return (
    <>
      <div className="flex justify-center mb-8">
        <img
          src={CONTROLLED_ENVIRONMENT ? "/flag.png" : "/carbon-mark-light.svg"}
          alt={t`Carbon Logo`}
          className="w-24 dark:hidden"
        />
        <img
          src={CONTROLLED_ENVIRONMENT ? "/flag.png" : "/carbon-mark-dark.svg"}
          alt={t`Carbon Logo`}
          className="w-24 hidden dark:block"
        />
      </div>
      <div className="rounded-lg md:bg-card md:border md:border-border md:shadow-lg p-8 w-[380px]">
        <VStack spacing={4} className="items-center justify-center text-center">
          <Heading size="h3">
            <Trans>Finish setting up your account</Trans>
          </Heading>
          <p className="text-muted-foreground tracking-tight text-sm">
            <Trans>
              Your account isn't part of a company yet. Complete onboarding in
              the Carbon ERP to continue.
            </Trans>
          </p>
          <Button size="lg" className="w-full" asChild>
            <a href={path.to.onboarding}>
              <Trans>Go to onboarding</Trans>
            </a>
          </Button>
        </VStack>
      </div>
    </>
  );
}
