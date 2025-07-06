import {
  error,
  getAppUrl,
  getCarbonServiceRole,
  getPermissionCacheKey,
} from "@carbon/auth";
import { flash, getAuthSession } from "@carbon/auth/session.server";
import { redis } from "@carbon/kv";
import { Button as _Button, Heading as _Heading, VStack } from "@carbon/react";
import { Form, Link, redirect, useLoaderData } from "@remix-run/react";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@vercel/remix";
import { AnimatePresence, motion } from "framer-motion";
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

  if (authSession) {
    await redis.del(getPermissionCacheKey(authSession.userId));
    throw redirect(path.to.authenticatedRoot);
  } else {
    const magicLink = await serviceRole.auth.admin.generateLink({
      type: "magiclink",
      email: accept.data.email,
      options: {
        redirectTo: `${getAppUrl()}/callback`,
      },
    });
    throw redirect(magicLink.data?.properties?.action_link ?? path.to.root);
  }
}

const fade = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
};

const Heading = motion(_Heading);
const Button = motion(_Button);

export default function Invite() {
  const { success, company } = useLoaderData<typeof loader>();

  if (!success) {
    return (
      <VStack spacing={4} className="max-w-lg items-center text-center">
        <div className="flex justify-center mb-4">
          <img src="/carbon-logo-mark.svg" alt="Carbon Logo" className="w-36" />
        </div>
        <VStack spacing={2} className="text-center w-full">
          <Heading className="w-full text-center">Invalid Invite</Heading>
          <p>
            Your invitation is invalid or has already been accepted. Please
            contact support if you believe this is an error.
          </p>
        </VStack>
        <Button asChild>
          <Link to="/">Return Home</Link>
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
          src="/carbon-logo-mark.svg"
          alt="Carbon Logo"
          className="w-24 mb-3"
        />

        <Heading
          {...fade}
          transition={{ duration: 1.2, ease: "easeInOut", delay: 1.5 }}
          size="h1"
          className="m-0"
        >
          Welcome to Carbon
        </Heading>

        <Form method="post">
          <Button
            {...fade}
            transition={{ duration: 1.2, ease: "easeInOut", delay: 1.5 }}
            size="lg"
            type="submit"
          >
            {`Join ${company?.name ?? "Company"}`}
          </Button>
        </Form>
      </VStack>

      <p className="text-xs text-muted-foreground  text-center">
        By accepting the invite, you agree to the{" "}
        <Link to="https://carbonos.dev/terms" className="underline">
          Terms of Service
        </Link>{" "}
        and{" "}
        <Link to="https://carbonos.dev/privacy" className="underline">
          Privacy Policy
        </Link>
        .
      </p>
    </AnimatePresence>
  );
}
