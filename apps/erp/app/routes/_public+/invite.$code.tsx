import {
  CarbonEdition,
  error,
  getAppUrl,
  getPermissionCacheKey
} from "@carbon/auth";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { setCompanyId } from "@carbon/auth/company.server";
import {
  flash,
  getAuthSession,
  updateCompanySession
} from "@carbon/auth/session.server";
import { redis } from "@carbon/kv";
import { Button as _Button, Heading as _Heading, VStack } from "@carbon/react";
import { updateSubscriptionQuantityForCompany } from "@carbon/stripe/stripe.server";
import { Edition } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { AnimatePresence, motion } from "framer-motion";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction
} from "react-router";
import { Form, Link, redirect, useLoaderData } from "react-router";
import { acceptInvite } from "~/modules/users/users.server";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Accept Invite | Carbon" }];
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { code } = params;
  if (!code) throw new Error("No code provided");

  const serviceRole = getCarbonServiceRole();
  const invite = await serviceRole
    .from("invite")
    .select("*, company(name)")
    .eq("code", code)
    .single();

  if (!invite.data || invite.data.acceptedAt) {
    return { success: false, company: null };
  }

  return { success: true, company: invite.data.company };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { code } = params;
  if (!code) throw new Error("No code provided");
  const authSession = await getAuthSession(request);

  const serviceRole = getCarbonServiceRole();

  const accept = await acceptInvite(serviceRole, code, authSession?.email);
  if (accept.error) {
    throw redirect(
      path.to.root,
      await flash(
        request,
        error(accept.error, accept.error.message ?? "Failed to accept invite")
      )
    );
  }

  if (CarbonEdition === Edition.Cloud) {
    await updateSubscriptionQuantityForCompany(accept.data.companyId);
  }

  if (authSession) {
    await redis.del(getPermissionCacheKey(authSession.userId));

    const { data: companyRecord } = await serviceRole
      .from("company")
      .select("companyGroupId")
      .eq("id", accept.data.companyId)
      .single();

    const sessionCookie = await updateCompanySession(
      request,
      accept.data.companyId,
      companyRecord?.companyGroupId ?? ""
    );
    const companyIdCookie = setCompanyId(accept.data.companyId);
    throw redirect(path.to.authenticatedRoot, {
      headers: [
        ["Set-Cookie", sessionCookie],
        ["Set-Cookie", companyIdCookie]
      ]
    });
  } else {
    const magicLink = await serviceRole.auth.admin.generateLink({
      type: "magiclink",
      email: accept.data.email,
      options: {
        redirectTo: `${getAppUrl()}/callback`
      }
    });
    throw redirect(magicLink.data?.properties?.action_link ?? path.to.root);
  }
}

const fade = {
  initial: { opacity: 0 },
  animate: { opacity: 1 }
};

const Heading = motion.create(_Heading);
const Button = motion.create(_Button);

export default function Invite() {
  const { success, company } = useLoaderData<typeof loader>();
  const { t } = useLingui();
  if (!success) {
    return (
      <VStack spacing={4} className="max-w-lg items-center text-center">
        <div className="flex justify-center mb-8">
          <img
            src="/carbon-mark-light.svg"
            alt={t`Carbon Logo`}
            className="w-24 dark:hidden"
          />
          <img
            src="/carbon-mark-dark.svg"
            alt={t`Carbon Logo`}
            className="w-24 hidden dark:block"
          />
        </div>
        <VStack spacing={2} className="text-center w-full">
          <Heading className="w-full text-center">
            <Trans>Invalid Invite</Trans>
          </Heading>
          <p>
            <Trans>
              Your invitation is invalid or has already been accepted. Please
              contact support if you believe this is an error.
            </Trans>
          </p>
        </VStack>
        <Button asChild>
          <Link to="/">
            <Trans>Return Home</Trans>
          </Link>
        </Button>
      </VStack>
    );
  }

  return (
    <AnimatePresence>
      <VStack spacing={4} className="max-w-lg items-center text-center">
        <motion.img
          initial={{ opacity: 0, scale: 0.4 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 2, ease: "easeInOut" }}
          src="/carbon-mark-light.svg"
          alt="Carbon Logo"
          className="w-24 dark:hidden"
        />
        <img
          src="/carbon-mark-dark.svg"
          alt="Carbon Logo"
          className="w-24 hidden dark:block"
        />

        <Heading
          {...fade}
          transition={{ duration: 1.2, ease: "easeInOut", delay: 1.5 }}
          size="h1"
          className="mb-4"
        >
          <Trans>Welcome to Carbon</Trans>
        </Heading>

        <Form method="post">
          <Button
            {...fade}
            transition={{ duration: 1.2, ease: "easeInOut", delay: 1.5 }}
            size="lg"
            type="submit"
          >
            <Trans>Join {company?.name ?? "Company"}</Trans>
          </Button>
        </Form>
      </VStack>

      <p className="text-xs text-muted-foreground  text-center">
        <Trans>
          By accepting the invite, you agree to the{" "}
          <Link to="https://carbon.ms/terms" className="underline">
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link to="https://carbon.ms/privacy" className="underline">
            Privacy Policy
          </Link>
          .
        </Trans>
      </p>
    </AnimatePresence>
  );
}
