import {
  CarbonEdition,
  CONTROLLED_ENVIRONMENT,
  error,
  getAppUrl,
  getPermissionCacheKey,
  RESEND_DOMAIN,
  success as successFlash
} from "@carbon/auth";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { setCompanyId } from "@carbon/auth/company.server";
import {
  flash,
  getAuthSession,
  updateCompanySession
} from "@carbon/auth/session.server";
import { insertAuditLogEntries } from "@carbon/database/audit";
import { InviteEmail } from "@carbon/documents/email";
import { Ratelimit, redis } from "@carbon/kv";
import { sendEmail } from "@carbon/lib/resend.server";
import { getLogger } from "@carbon/logger";
import { Button as _Button, Heading as _Heading, VStack } from "@carbon/react";
import { updateSubscriptionQuantityForCompany } from "@carbon/stripe/stripe.server";
import { datetime, Edition } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { render } from "@react-email/components";
import { AnimatePresence, motion } from "framer-motion";
import { nanoid } from "nanoid";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction
} from "react-router";
import { Form, Link, redirect, useLoaderData } from "react-router";
import {
  acceptInvite,
  isControlledInviteExpired
} from "~/modules/users/users.server";
import { path } from "~/utils/path";

const logger = getLogger("erp", "invite");

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

  if (!invite.data || invite.data.acceptedAt || invite.data.revokedAt) {
    return { success: false, expired: false, company: null };
  }

  // Controlled environments expire invites 7 days after creation. Surface this
  // as a distinct state so the invitee can self-serve a fresh invite.
  if (isControlledInviteExpired(invite.data.createdAt)) {
    return { success: false, expired: true, company: invite.data.company };
  }

  return {
    success: true,
    expired: false,
    company: invite.data.company,
    controlledEnvironment: CONTROLLED_ENVIRONMENT
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { code } = params;
  if (!code) throw new Error("No code provided");

  const formData = await request.formData();
  const intent = formData.get("intent") as string | null;
  const serviceRole = getCarbonServiceRole();

  if (intent === "request-new") {
    return requestNewInvite(request, code, serviceRole);
  }

  const authSession = await getAuthSession(request);

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

  // Best-effort audit of the acceptance, with request metadata.
  try {
    await insertAuditLogEntries(serviceRole, accept.data.companyId, [
      {
        tableName: "invite",
        entityType: "invite",
        entityId: accept.data.id,
        recordId: accept.data.id,
        operation: "UPDATE",
        actorId: null,
        diff: { acceptedAt: { old: null, new: accept.data.acceptedAt } },
        metadata: {
          ipAddress:
            request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
            undefined,
          userAgent: request.headers.get("user-agent") ?? undefined
        }
      }
    ]);
  } catch (err) {
    logger.warn("[invite] audit write skipped for accept", { error: err });
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
        redirectTo: `${getAppUrl()}/callback?redirectTo=${encodeURIComponent(
          path.to.api.link(accept.data.companyId)
        )}`
      }
    });
    throw redirect(magicLink.data?.properties?.action_link ?? path.to.root, {
      headers: [["Set-Cookie", setCompanyId(accept.data.companyId)]]
    });
  }
}

/**
 * Self-serve reissue for an expired invite: regenerate the code, reset the
 * expiry window, and re-send the invite email to the same address. Rate-limited
 * per (company, email). Only reissues to the already-invited email — no new
 * grant, so it's safe from an unauthenticated page.
 */
async function requestNewInvite(
  request: Request,
  code: string,
  serviceRole: ReturnType<typeof getCarbonServiceRole>
) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "127.0.0.1";
  const location = request.headers.get("x-vercel-ip-city") ?? "Unknown";

  const invite = await serviceRole
    .from("invite")
    .select("email, companyId, createdBy, acceptedAt, revokedAt, company(name)")
    .eq("code", code)
    .maybeSingle();

  if (invite.error || !invite.data) {
    throw redirect(
      path.to.root,
      await flash(request, error(invite.error, "Invite not found"))
    );
  }

  if (invite.data.acceptedAt) {
    throw redirect(
      path.to.root,
      await flash(request, error(null, "This invite has already been accepted"))
    );
  }

  // A revoked invite must stay revoked — never resurrect it via self-serve
  // reissue. Only an admin-initiated resend may un-revoke (resend-invite.tsx).
  if (invite.data.revokedAt) {
    throw redirect(
      path.to.root,
      await flash(request, error(null, "This invite is no longer valid"))
    );
  }

  const ratelimit = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(3, "1 h"),
    analytics: true
  });
  const limited = await ratelimit.limit(
    `invite-request:${invite.data.companyId}:${invite.data.email}`
  );
  if (!limited.success) {
    throw redirect(
      path.to.root,
      await flash(
        request,
        error(null, "Too many requests. Please try again later.")
      )
    );
  }

  const newCode = nanoid();
  const refreshed = await serviceRole
    .from("invite")
    // Not accepted and not revoked (guarded above) — self-serve reissue only
    // resets the code + expiry window; it never clears acceptedAt/revokedAt.
    .update({
      code: newCode,
      createdAt: datetime.timestamp()
    })
    .eq("code", code)
    .select("code")
    .single();

  if (refreshed.error || !refreshed.data) {
    throw redirect(
      path.to.root,
      await flash(
        request,
        error(refreshed.error, "Failed to create a new invite")
      )
    );
  }

  const inviter = await serviceRole
    .from("user")
    .select("email, fullName")
    .eq("id", invite.data.createdBy)
    .single();

  await sendEmail({
    from: `Carbon <no-reply@${RESEND_DOMAIN}>`,
    to: invite.data.email,
    subject: `You have been invited to join ${invite.data.company?.name} on Carbon`,
    headers: { "X-Entity-Ref-ID": nanoid() },
    html: await render(
      InviteEmail({
        invitedByEmail: inviter.data?.email ?? invite.data.email,
        invitedByName: inviter.data?.fullName ?? "",
        email: invite.data.email,
        name: "",
        companyName: invite.data.company?.name ?? "Carbon",
        inviteLink: `${getAppUrl()}/invite/${refreshed.data.code}`,
        ip,
        location,
        controlledEnvironment: CONTROLLED_ENVIRONMENT
      })
    )
  });

  throw redirect(
    path.to.root,
    await flash(
      request,
      successFlash("A new invite has been sent to your email.")
    )
  );
}

const fade = {
  initial: { opacity: 0 },
  animate: { opacity: 1 }
};

const Heading = motion.create(_Heading);
const Button = motion.create(_Button);

export default function Invite() {
  const data = useLoaderData<typeof loader>();
  const { success, expired, company } = data;
  const controlledEnvironment =
    "controlledEnvironment" in data ? data.controlledEnvironment : false;
  const { t } = useLingui();

  if (expired) {
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
            <Trans>Invite Expired</Trans>
          </Heading>
          <p>
            <Trans>
              This invitation to join {company?.name ?? "Carbon"} has expired.
              You can request a new invite to be sent to your email.
            </Trans>
          </p>
        </VStack>
        <Form method="post">
          <input type="hidden" name="intent" value="request-new" />
          <Button type="submit">
            <Trans>Request a new invite</Trans>
          </Button>
        </Form>
      </VStack>
    );
  }

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

        {controlledEnvironment ? (
          <p className="text-sm text-muted-foreground text-center max-w-md">
            <Trans>
              This is an ITAR-controlled environment. Access is restricted to
              U.S. Persons.
            </Trans>
          </p>
        ) : null}
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
