import {
  CarbonEdition,
  CarbonProvider,
  CONTROLLED_ENVIRONMENT,
  getAppUrl,
  getCarbon,
  getCompanies,
  getUser,
  ITAR_RIDER_PDF_PATH,
  isAuthProviderEnabled,
  SESSION_HEARTBEAT_MS,
  SESSION_IDLE_LOCK_MS
} from "@carbon/auth";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { userHasVerifiedTotpFactor } from "@carbon/auth/mfa.server";
import {
  destroyAuthSession,
  requireAuthSession
} from "@carbon/auth/session.server";
import type { PrintingSettings } from "@carbon/printing";
import { getPrinterRoutes } from "@carbon/printing";
import { PrintingProvider } from "@carbon/printing/ui";
import {
  Button,
  Heading,
  ItarEntityPendingBlock,
  ItarUserCertification,
  SidebarProvider,
  TooltipProvider,
  useKeyboardWedge,
  useNProgress,
  VStack
} from "@carbon/react";
import { getStripeCustomerByCompanyId } from "@carbon/stripe/stripe.server";
import {
  Edition,
  isSearchParamOnlyNavigation,
  requiresItarEntityCertification
} from "@carbon/utils";
import { Trans } from "@lingui/react/macro";
import posthog from "posthog-js";
import type { ReactNode } from "react";
import { Suspense, useEffect } from "react";
import type {
  LoaderFunctionArgs,
  MiddlewareFunction,
  ShouldRevalidateFunction
} from "react-router";
import {
  Await,
  data,
  Form,
  Outlet,
  redirect,
  useLoaderData,
  useNavigate
} from "react-router";
import { AppSidebar } from "~/components";
import { ConsolePill } from "~/components/ConsolePill";
import { PinInOverlay } from "~/components/PinInOverlay";
import RealtimeDataProvider from "~/components/RealtimeDataProvider";
import SessionLockOverlay from "~/components/SessionLockOverlay";
import { TimeCardWarning } from "~/components/TimeCardWarning";
import { userContext } from "~/context";
import { useIdle } from "~/hooks";
import { userMiddleware } from "~/middleware/user";
import { refreshConsolePinIn } from "~/services/console.server";
import { getItarCertificationStatus } from "~/services/itar.service";
import { getActiveMaintenanceEventsCount } from "~/services/maintenance.service";
import {
  getActiveJobCount,
  getLocationsByCompany
} from "~/services/operations.service";
import { getOpenClockEntry } from "~/services/people.service";
import { ERP_URL, MES_URL, path } from "~/utils/path";

export const shouldRevalidate: ShouldRevalidateFunction = ({
  currentUrl,
  nextUrl,
  formMethod,
  defaultShouldRevalidate
}) => {
  if (
    currentUrl.pathname.startsWith("/refresh-session") ||
    currentUrl.pathname.startsWith("/switch-company") ||
    currentUrl.pathname.startsWith("/x/acknowledge")
  ) {
    return true;
  }

  // This loader is the app shell: 9 queries plus an auth round-trip. Without
  // this it re-ran on every filter, sort and page click, none of which can
  // change anything it returns.
  // NOTE: `useRevalidator().revalidate()` — how the realtime hooks refresh —
  // also looks like a same-pathname GET, so the shell does not re-run for
  // realtime events either. Leaf loaders still refresh, which is the intent.
  // Shell data that must react to a realtime change needs an explicit case
  // above.
  if (isSearchParamOnlyNavigation({ currentUrl, nextUrl, formMethod })) {
    return false;
  }

  return defaultShouldRevalidate;
};

export const middleware: MiddlewareFunction[] = [userMiddleware];

export async function loader({ request, context }: LoaderFunctionArgs) {
  const authSession = await requireAuthSession(request, { verify: true });
  const { accessToken, companyId, expiresAt, expiresIn, userId } = authSession;

  // share a client between requests
  const client = getCarbon(accessToken);

  // parallelize the requests
  const [companies, user] = await Promise.all([
    getCompanies(client, userId),
    getUser(client, userId)
  ]);

  if (user.error || !user.data) {
    throw await destroyAuthSession(request);
  }

  const company = companies.data?.find((c) => c.companyId === companyId);
  if (!company) {
    // A company-less authenticated user (e.g. an enterprise first-run user who
    // hasn't onboarded) has no MES to enter — MES doesn't host onboarding.
    // Send them to a terminal screen that links to ERP onboarding, not into
    // accountSettings (an ERP /x route that would itself bounce a no-company
    // user, i.e. a redirect loop).
    throw redirect(path.to.setupRequired);
  }

  // Get the location and console state from middleware context
  const ctx = context.get(userContext);
  const locationId = ctx?.locationId;
  const consoleMode = ctx?.consoleMode ?? false;
  const pinnedInUser = ctx?.pinnedInUser ?? null;
  const effectiveUserId = ctx?.effectiveUserId ?? userId;

  const serviceRole = getCarbonServiceRole();

  let [
    companyPlan,
    locations,
    activeEvents,
    companySettings,
    openClockEntry,
    locationEmployees,
    printerRoutes
  ] = await Promise.all([
    getStripeCustomerByCompanyId(companyId, userId),
    getLocationsByCompany(client, companyId),
    getActiveJobCount(client, {
      employeeId: effectiveUserId,
      companyId
    }),
    client
      .from("companySettings")
      .select(
        "timeCardEnabled, consoleEnabled, printing, useMetric, requireMfa"
      )
      .eq("id", companyId)
      .single(),
    getOpenClockEntry(client, effectiveUserId, companyId),
    // Get employees at current location for console mode pin-in filtering
    consoleMode && locationId
      ? serviceRole
          .from("employeeJob")
          .select("id")
          .eq("locationId", locationId)
          .eq("companyId", companyId)
      : Promise.resolve({ data: [] as { id: string }[] }),
    getPrinterRoutes(serviceRole, companyId)
  ]);

  const locationEmployeeIds =
    locationEmployees.data?.map((e: { id: string }) => e.id) ?? [];
  const timeCardEnabled = companySettings.data?.timeCardEnabled ?? false;
  const consoleEnabled = companySettings.data?.consoleEnabled ?? false;

  // Org-enforced MFA, mirroring the ERP shell. Enrollment itself lives only in
  // the ERP (MES has no account settings), so the gate here points there.
  // Console terminals are exempt: the operators pinning in are not the session
  // user, and a shared kiosk cannot complete a personal enrollment.
  const mfaRequired =
    !consoleMode &&
    (CONTROLLED_ENVIRONMENT || companySettings.data?.requireMfa === true);
  // SSO sessions trust the IdP for MFA in all environments, including
  // controlled — user decision, mirroring the ERP shell.
  const ssoMfaExempt = Boolean(authSession.ssoProviderId);
  const mfaEnrollmentRequired =
    mfaRequired && !ssoMfaExempt
      ? !(await userHasVerifiedTotpFactor(userId))
      : false;

  // Get active maintenance count after we have the location
  const activeMaintenanceCount = await getActiveMaintenanceEventsCount(
    client,
    locationId
  );

  // ITAR gate — only queried in controlled environments. `entityRequired` is
  // false for Carbon staff: the Rider binds the customer's own organization, so
  // it is not ours to accept and the pending block would strand us behind a
  // signature we can never provide. Decided server-side from the account's
  // email, and defaults to required when the email is unknown.
  const itarCertification = CONTROLLED_ENVIRONMENT
    ? {
        ...(await getItarCertificationStatus(client, companyId, userId)),
        entityRequired: requiresItarEntityCertification(user.data?.email)
      }
    : { entityCertified: true, userCertified: true, entityRequired: false };

  if (!companyPlan && CarbonEdition === Edition.Cloud) {
    throw redirect(path.to.onboarding);
  }

  if (!locations.data || locations.data.length === 0) {
    throw new Error(`No locations found for ${company.name}`);
  }

  // Sliding window: refresh pin-in cookie on every page load
  const headers = new Headers();
  if (pinnedInUser && ctx) {
    headers.append(
      "Set-Cookie",
      refreshConsolePinIn(companyId, {
        userId: pinnedInUser.userId,
        name: pinnedInUser.name,
        avatarUrl: pinnedInUser.avatarUrl,
        pinnedAt: Date.now()
      })
    );
  }

  return data(
    {
      session: {
        accessToken,
        expiresIn,
        expiresAt
      },
      activeEvents: activeEvents.data ?? 0,
      activeMaintenanceCount: activeMaintenanceCount.count ?? 0,
      company,
      companies: companies.data ?? [],
      consoleEnabled,
      consoleMode: consoleEnabled && consoleMode,
      location: locationId,
      locationEmployeeIds,
      locations: locations.data ?? [],
      openClockEntry: openClockEntry?.data
        ? getOpenClockEntry(client, userId, companyId)
        : null,
      effectiveUserId,
      pinnedInUser,
      plan: companyPlan?.planId,
      printing:
        (companySettings.data?.printing as PrintingSettings | null) ?? null,
      printerRoutes: printerRoutes.data ?? [],
      timeCardEnabled,
      useMetric: companySettings.data?.useMetric ?? false,
      user: user.data,
      itarCertification,
      // Server-decided, never client-inferred — same reason as the ITAR gate.
      mfaEnrollmentRequired,
      // Session lock (NIST 3.1.10) — client idle UX config. Console DEVICE
      // sessions are exempt (their lock is the operator pin-in; a shared kiosk
      // must not be force-logged-out mid-shift). Server enforcement lives in
      // requireAuthSession, which also skips console sessions.
      sessionTimeout: {
        enabled: CONTROLLED_ENVIRONMENT && !(consoleEnabled && consoleMode),
        idleMs: SESSION_IDLE_LOCK_MS,
        heartbeatMs: SESSION_HEARTBEAT_MS,
        // Offer passkey re-auth on the lock overlay when the provider is enabled;
        // the /unlock action gates the actual credential, TOTP stays available.
        hasPasskeyAuth: isAuthProviderEnabled("passkey")
      }
    },
    headers.has("Set-Cookie") ? { headers } : undefined
  );
}

export default function AuthenticatedRoute() {
  const {
    session,
    activeEvents,
    activeMaintenanceCount,
    company,
    companies,
    consoleEnabled,
    consoleMode,
    location,
    locationEmployeeIds,
    locations,
    openClockEntry,
    pinnedInUser,
    printing,
    printerRoutes,
    timeCardEnabled,
    useMetric,
    user,
    itarCertification,
    mfaEnrollmentRequired,
    sessionTimeout
  } = useLoaderData<typeof loader>();

  const navigate = useNavigate();

  // Session lock (NIST 3.1.10) — client idle UX only; server enforces in
  // requireAuthSession. Inert unless CONTROLLED_ENVIRONMENT and non-console.
  const { isIdle, resume } = useIdle({
    enabled: sessionTimeout.enabled,
    idleMs: sessionTimeout.idleMs,
    heartbeatMs: sessionTimeout.heartbeatMs,
    heartbeatUrl: "/api/session/heartbeat"
  });

  // Console (shared-kiosk) idle lock (NIST 3.1.10). A controlled-environment
  // console session is exempt from the session-wide lock above (sessionTimeout.
  // enabled is false for it) — its lock is the operator pin-in. On idle, reload:
  // the server-tightened pin-in (console.server) has by then expired, so the
  // reload surfaces the PinInOverlay and the operator must re-PIN.
  const { isIdle: consoleIsIdle } = useIdle({
    enabled: CONTROLLED_ENVIRONMENT && consoleMode,
    idleMs: sessionTimeout.idleMs,
    heartbeatMs: sessionTimeout.heartbeatMs,
    heartbeatUrl: "/api/session/heartbeat"
  });
  useEffect(() => {
    if (consoleIsIdle && typeof window !== "undefined") {
      window.location.reload();
    }
  }, [consoleIsIdle]);

  useNProgress();
  useKeyboardWedge({
    test: (input) =>
      (input.startsWith(MES_URL) || input.startsWith(ERP_URL)) &&
      !input.includes("/kanban/complete/"), // we handle this more gracefully in JobOperation
    callback: (input) => {
      try {
        const url = new URL(input);
        navigate(url.pathname + url.search);
      } catch {
        navigate(input);
      }
    }
  });

  const userId = user?.id;
  const userEmail = user?.email;
  const userFullName = user ? `${user.firstName} ${user.lastName}` : undefined;
  const companyId = company?.companyId;
  const companyName = company?.name;

  // Keyed on the identity rather than run once on mount: switching company
  // redirects back into x+/_layout without unmounting it, so a mount-only
  // effect would leave the previous company attached to every later event.
  // The deps are primitives because `user`/`company` get fresh object
  // identities on every revalidation, and group() re-sends $groupidentify
  // each time it is called.
  useEffect(() => {
    if (!userId) return;

    posthog.identify(userId, { email: userEmail, name: userFullName });

    if (!companyId) return;

    // Adoption is measured per customer, and a user can belong to more than one
    // company — so the company rides on the events rather than on the person.
    // register() puts companyId on every event including autocapture; group()
    // is what lets PostHog aggregate by customer.
    posthog.register({ companyId });
    posthog.group("company", companyId, { name: companyName });
  }, [userId, userEmail, userFullName, companyId, companyName]);

  // Scroll stays unlocked until lg, where the controls dock beside the content
  // instead of stacking below it.
  // ITAR gate. Entity Rider acceptance is an admin action performed in the ERP,
  // so shop-floor MES users never see Screen 1 — they wait on the pending block
  // until an admin accepts, then attest their own U.S.-Person status.
  //
  // Carbon staff are exempt from the entity gate entirely (the Rider binds the
  // customer's organization, not ours), so they skip the pending block too and
  // go straight to their own attestation.
  // Enforced-MFA gate. Enrollment is an ERP-only flow, so this screen sends
  // them there rather than trying to run a QR ceremony on the shop floor.
  const mfaScreen: ReactNode = mfaEnrollmentRequired ? (
    <div className="flex flex-col items-center justify-center h-full w-full p-8">
      <div className="rounded-lg bg-card border border-border shadow-lg p-8 w-[420px] max-w-full">
        <VStack spacing={4} className="items-center">
          <Heading size="h3" className="text-center">
            <Trans>Two-factor authentication required</Trans>
          </Heading>
          <p className="text-muted-foreground tracking-tight text-sm text-center">
            <Trans>
              Your organization requires an authenticator app. Set it up in
              Carbon, then come back here.
            </Trans>
          </p>
          <Button size="lg" className="w-full" asChild>
            <a href={`${getAppUrl()}/x/account/profile`}>
              <Trans>Set up in Carbon</Trans>
            </a>
          </Button>
          <Form method="post" action={path.to.logout} className="w-full">
            <Button
              type="submit"
              variant="link"
              size="sm"
              className="w-full text-muted-foreground"
            >
              <Trans>Sign out</Trans>
            </Button>
          </Form>
        </VStack>
      </div>
    </div>
  ) : null;

  let itarScreen: ReactNode = null;
  const entityBlocking =
    itarCertification.entityRequired && !itarCertification.entityCertified;
  if (
    CONTROLLED_ENVIRONMENT &&
    (entityBlocking || !itarCertification.userCertified)
  ) {
    itarScreen = entityBlocking ? (
      <ItarEntityPendingBlock logoutAction={path.to.logout} />
    ) : (
      <ItarUserCertification
        riderPdfPath={ITAR_RIDER_PDF_PATH}
        acknowledgeAction={path.to.acknowledge}
        logoutAction={path.to.logout}
      />
    );
  }

  return (
    <div className="h-screen w-full overflow-y-auto lg:overflow-hidden">
      {/* Idle lock conceals the app (3.1.10). Not over the ITAR/MFA gates. */}
      {isIdle && !itarScreen && !mfaScreen && (
        <SessionLockOverlay
          onUnlocked={resume}
          hasPasskeyAuth={sessionTimeout.hasPasskeyAuth}
        />
      )}
      {(itarScreen ?? mfaScreen) ? (
        (itarScreen ?? mfaScreen)
      ) : (
        <CarbonProvider session={session}>
          <PrintingProvider
            value={{
              printing,
              printerRoutes,
              useMetric,
              printPath: path.to.manualPrint,
              settingsPath: path.to.printingSettings,
              settingsExternal: true
            }}
          >
            <RealtimeDataProvider>
              <SidebarProvider defaultOpen={false} touch>
                <TooltipProvider delayDuration={0}>
                  <AppSidebar
                    activeEvents={activeEvents}
                    activeMaintenanceCount={activeMaintenanceCount}
                    company={company}
                    companies={companies}
                    consoleEnabled={consoleEnabled}
                    consoleMode={consoleMode}
                    location={location}
                    locations={locations}
                    openClockEntry={openClockEntry}
                    pinnedInUser={pinnedInUser}
                    timeCardEnabled={timeCardEnabled}
                  />
                  <div className="flex flex-1 flex-col min-w-0 overflow-hidden bg-card md:mt-2 md:mr-2 md:mb-2 md:rounded-2xl md:border md:border-border">
                    <Outlet />
                  </div>
                  {timeCardEnabled && (
                    <Suspense fallback={null}>
                      <Await resolve={openClockEntry}>
                        {(resolved) => (
                          <TimeCardWarning
                            openClockEntry={
                              resolved?.data
                                ? {
                                    id: resolved.data.id,
                                    clockIn: resolved.data.clockIn
                                  }
                                : null
                            }
                          />
                        )}
                      </Await>
                    </Suspense>
                  )}
                  {consoleMode && !pinnedInUser && (
                    <PinInOverlay
                      companyId={company.companyId!}
                      locationEmployeeIds={locationEmployeeIds}
                      sessionUserId={user?.id ?? ""}
                      hasPinnedUser={false}
                    />
                  )}
                  {consoleMode && pinnedInUser && (
                    <ConsolePill
                      user={pinnedInUser}
                      companyId={company.companyId!}
                      locationEmployeeIds={locationEmployeeIds}
                      sessionUserId={user?.id ?? ""}
                    />
                  )}
                </TooltipProvider>
              </SidebarProvider>
            </RealtimeDataProvider>
          </PrintingProvider>
        </CarbonProvider>
      )}
    </div>
  );
}
