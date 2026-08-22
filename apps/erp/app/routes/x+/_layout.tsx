import {
  CarbonEdition,
  CarbonProvider,
  CONTROLLED_ENVIRONMENT,
  getCarbon,
  getMESUrl,
  ITAR_RIDER_PDF_PATH,
  isAuthProviderEnabled,
  SESSION_HEARTBEAT_MS,
  SESSION_IDLE_LOCK_MS
} from "@carbon/auth";
import { getCompanyId, setCompanyId } from "@carbon/auth/company.server";
import { userHasVerifiedTotpFactor } from "@carbon/auth/mfa.server";
import {
  destroyAuthSession,
  requireAuthSession,
  updateCompanySession
} from "@carbon/auth/session.server";
import { isAuditLogEnabled } from "@carbon/database/audit";
import {
  detectImplementationSignals,
  getImplementationCheckStates,
  getImplementationHub
} from "@carbon/onboarding/server";
import type { PrintingSettings } from "@carbon/printing";
import { getPrinterRoutes } from "@carbon/printing";
import { PrintingProvider } from "@carbon/printing/ui";
import {
  ItarEntityCertification,
  ItarEntityPendingBlock,
  ItarUserCertification,
  TooltipProvider,
  useKeyboardWedge,
  useNProgress
} from "@carbon/react";
import { getStripeCustomerByCompanyId } from "@carbon/stripe/stripe.server";
import {
  Edition,
  isSearchParamOnlyNavigation,
  requiresItarEntityCertification
} from "@carbon/utils";
import posthog from "posthog-js";
import type { ReactNode } from "react";
import { Suspense, useEffect } from "react";
import type {
  LoaderFunctionArgs,
  ShouldRevalidateFunction
} from "react-router";
import {
  Await,
  data,
  Outlet,
  redirect,
  useLoaderData,
  useNavigate
} from "react-router";
import { RealtimeDataProvider } from "~/components";
import { PrimaryNavigation, Topbar } from "~/components/Layout";
import MfaEnrollmentRequired from "~/components/MfaEnrollmentRequired";
import SessionLockOverlay from "~/components/SessionLockOverlay";
import { TimeCardWarning } from "~/components/TimeCardWarning";
import TrainingPanel from "~/components/TrainingPanel";
import { useIdle, usePermissions, useRecordRecentlyViewed } from "~/hooks";
import { useTrainingPanel } from "~/hooks/useTrainingPanel";
import { AgentRoot } from "~/modules/agent/ui/AgentRoot";
import { getOpenClockEntry } from "~/modules/people";
import {
  getCompanies,
  getCompanyIntegrations,
  getCompanySettings,
  getEmployeeCompanies
} from "~/modules/settings";
import { getCustomFieldsSchemas } from "~/modules/shared/shared.server";
import {
  getSavedViews,
  isApprovalRequired
} from "~/modules/shared/shared.service";
import { getItarCertificationStatus } from "~/modules/users";
import {
  getModulePreferences,
  getUser,
  getUserClaims,
  getUserDefaults,
  getUserGroups
} from "~/modules/users/users.server";
import { ERP_URL, MES_URL, path } from "~/utils/path";

export const shouldRevalidate: ShouldRevalidateFunction = ({
  currentUrl,
  nextUrl,
  formMethod,
  defaultShouldRevalidate
}) => {
  if (
    currentUrl.pathname.startsWith("/x/settings") ||
    currentUrl.pathname.startsWith("/x/users") ||
    currentUrl.pathname.startsWith("/refresh-session") ||
    currentUrl.pathname.startsWith("/x/acknowledge") ||
    currentUrl.pathname.startsWith("/x/get-started") ||
    currentUrl.pathname.startsWith("/x/shared/views")
  ) {
    return true;
  }

  // This loader is the app shell: 16 parallel queries plus an auth round-trip.
  // Without this it re-ran on every table filter, sort and page click, none of
  // which can change anything it returns.
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

export async function loader({ request }: LoaderFunctionArgs) {
  const authSession = await requireAuthSession(request, { verify: true });
  const { accessToken, companyId, expiresAt, expiresIn, userId } = authSession;

  // Block ERP access when console mode is active on this terminal.
  // Console terminals should only access the MES app.
  if (authSession.console) {
    throw redirect(getMESUrl());
  }

  // const { computeRegion, proxyRegion } = parseVercelId(
  //   request.headers.get("x-vercel-id")
  // );

  // console.log({
  //   computeRegion,
  //   proxyRegion,
  // });

  const client = getCarbon(accessToken);

  // Only probe product signals when the company is actually enrolled, so the
  // home card + nav badge count gates the same way the hub page does. Chained
  // off the hub query rather than awaited after the fan-out below, so the
  // probes overlap the rest of it instead of forming a second serial wave.
  const implementationHubPromise = getImplementationHub(client, companyId);
  const implementationSignalsPromise = implementationHubPromise.then((hub) =>
    hub.data ? detectImplementationSignals(client, companyId) : null
  );

  // ITAR gate status — only queried in controlled environments; elsewhere the
  // gate never renders, so default to "certified" and skip the round-trip.
  // `entityRequired` is layered on below, once the user's email is known.
  const itarCertificationPromise = CONTROLLED_ENVIRONMENT
    ? getItarCertificationStatus(client, companyId, userId)
    : Promise.resolve({ entityCertified: true, userCertified: true });

  // Parallelize all requests
  const [
    companies,
    employeeCompaniesResult,
    stripeCustomer,
    customFields,
    integrations,
    companySettings,
    savedViews,
    user,
    claims,
    groups,
    defaults,
    auditLogEnabled,
    modulePreferences,
    printerRoutes,
    implementationHub,
    implementationCheckStates,
    implementationSignals,
    itarCertification
  ] = await Promise.all([
    getCompanies(client, userId),
    getEmployeeCompanies(client, userId),
    getStripeCustomerByCompanyId(companyId, userId),
    getCustomFieldsSchemas(client, { companyId }),
    getCompanyIntegrations(client, companyId),
    getCompanySettings(client, companyId),
    getSavedViews(client, userId, companyId),
    getUser(client, userId),
    getUserClaims(userId, companyId),
    getUserGroups(client, userId),
    getUserDefaults(client, userId, companyId),
    // Throws, unlike the {data, error} services around it — unguarded, a
    // transient timeout on this flag 500s every page under /x.
    isAuditLogEnabled(client, companyId).catch(() => false),
    getModulePreferences(client, userId, companyId),
    getPrinterRoutes(client, companyId),
    implementationHubPromise,
    getImplementationCheckStates(client, companyId),
    implementationSignalsPromise,
    itarCertificationPromise
  ]);

  if (!claims || user.error || !user.data || !groups.data) {
    throw await destroyAuthSession(request);
  }

  const employeeCompanies = employeeCompaniesResult.data ?? [];
  const hasMultipleCompanies = employeeCompanies.length > 1;

  // Send multi-company users to the picker, preserving where they were headed.
  const redirectToPicker = () => {
    const url = new URL(request.url);
    const dest = `${url.pathname}${url.search}`;
    return redirect(
      `${path.to.selectCompany}?redirectTo=${encodeURIComponent(dest)}`
    );
  };

  // Multi-company users must actively choose a company. The companyId cookie is
  // the "has chosen this session" marker — set only by the picker / company
  // switch and cleared on logout. Until it's present, force the picker so we
  // never silently serve the alphabetically-first company.
  if (hasMultipleCompanies && !getCompanyId(request)) {
    throw redirectToPicker();
  }

  let company = companies.data?.find((c) => c.companyId === companyId);

  if (!company && companies.data?.length) {
    // Session company is no longer valid (e.g. access revoked). Multi-company
    // users re-pick; single-company users auto-enter their only company.
    if (hasMultipleCompanies) {
      throw redirectToPicker();
    }
    company = employeeCompanies[0] ?? companies.data[0];
    const sessionCookie = await updateCompanySession(
      request,
      company.id!,
      company.companyGroupId ?? ""
    );
    const companyIdCookie = setCompanyId(company.id!);
    throw redirect(path.to.authenticatedRoot, {
      headers: [
        ["Set-Cookie", sessionCookie],
        ["Set-Cookie", companyIdCookie]
      ]
    });
  }

  const requiresOnboarding =
    !company?.name || (CarbonEdition === Edition.Cloud && !stripeCustomer);
  if (requiresOnboarding) {
    throw redirect(path.to.onboarding.root);
  }

  // Org-enforced MFA. A controlled deployment forces it regardless of the
  // company toggle (NIST 800-171 3.5.3 requires MFA for network access to
  // non-privileged accounts), so a company cannot switch it back off.
  const mfaRequired =
    CONTROLLED_ENVIRONMENT || companySettings.data?.requireMfa === true;
  // Redis-cached + memoized per read; only queried when it could gate.
  const mfaEnrolled = mfaRequired
    ? await userHasVerifiedTotpFactor(userId)
    : true;

  return data({
    session: {
      accessToken,
      expiresIn,
      expiresAt
    },
    auditLogEnabled,
    company,
    companies: companies.data ?? [],
    companySettings: companySettings.data ?? null,
    customFields: customFields.data ?? [],
    defaults: defaults.data,
    integrations: integrations.data ?? [],
    groups: groups.data,
    permissions: claims?.permissions,
    plan: stripeCustomer?.planId,
    role: claims?.role,
    user: user.data,
    modulePreferences: modulePreferences.data ?? [],
    savedViews: savedViews.data ?? [],
    printerRoutes: printerRoutes.data ?? [],
    implementationHub: implementationHub.data ?? null,
    implementationCheckStates: implementationCheckStates.data ?? [],
    implementationSignals,
    itarCertification: {
      ...itarCertification,
      // Server-decided, never client-inferred: the gate must not be skippable
      // by anything the browser can set.
      entityRequired: requiresItarEntityCertification(user.data.email)
    },
    mfaEnrollment: {
      // Server-decided, never client-inferred — same reason as the ITAR gate.
      required: mfaRequired && !mfaEnrolled,
      controlledEnvironment: CONTROLLED_ENVIRONMENT
    },
    // Session lock/termination (NIST 3.1.10/3.1.11) — client idle UX config. The
    // ERP shell already redirected any console session to MES above, so no console
    // exemption is needed here. Server enforcement lives in requireAuthSession.
    sessionTimeout: {
      enabled: CONTROLLED_ENVIRONMENT,
      idleMs: SESSION_IDLE_LOCK_MS,
      heartbeatMs: SESSION_HEARTBEAT_MS,
      // Offer passkey re-auth on the lock overlay when the provider is enabled;
      // the /unlock action gates the actual credential, TOTP stays available.
      hasPasskeyAuth: isAuthProviderEnabled("passkey")
    },
    supplierApprovalRequired: isApprovalRequired(client, "supplier", companyId),
    openClockEntry: companySettings.data?.timeCardEnabled
      ? getOpenClockEntry(client, userId, companyId)
      : null
  });
}

export default function AuthenticatedRoute() {
  const {
    company,
    session,
    user,
    companySettings,
    openClockEntry,
    printerRoutes,
    itarCertification,
    mfaEnrollment,
    sessionTimeout
  } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const permissions = usePermissions();
  const { isOpen, training, dismiss } = useTrainingPanel();

  // Session lock (NIST 3.1.10) — client idle UX only; the server enforces in
  // requireAuthSession. Inert unless CONTROLLED_ENVIRONMENT.
  const { isIdle, resume } = useIdle({
    enabled: sessionTimeout.enabled,
    idleMs: sessionTimeout.idleMs,
    heartbeatMs: sessionTimeout.heartbeatMs,
    heartbeatUrl: "/api/session/heartbeat"
  });

  useNProgress();
  useKeyboardWedge({
    test: (input) => input.startsWith(MES_URL) || input.startsWith(ERP_URL),
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

  // Record every detail document the user opens, for the home page's
  // "Recently viewed" list. Reads the record's title from its breadcrumb handle,
  // so no per-route wiring is needed.
  useRecordRecentlyViewed(companyId);

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

  // ITAR gate: entity Rider acceptance first (only an admin who can bind the
  // company may accept it; everyone else waits), then the user's own U.S.-Person
  // attestation. Declining either logs the user out.
  //
  // `entityRequired` is false for Carbon staff — they provision customer tenants
  // and so hold users_update there, but the Rider binds the customer's own
  // organization and is not theirs to sign. They fall straight through to their
  // own attestation; the customer's first admin binds the customer.
  let itarScreen: ReactNode = null;
  const entityBlocking =
    itarCertification.entityRequired && !itarCertification.entityCertified;
  if (
    CONTROLLED_ENVIRONMENT &&
    (entityBlocking || !itarCertification.userCertified)
  ) {
    if (entityBlocking) {
      itarScreen = permissions.can("update", "users") ? (
        <ItarEntityCertification
          companyName={companyName ?? "your company"}
          riderPdfPath={ITAR_RIDER_PDF_PATH}
          acknowledgeAction={path.to.acknowledge}
          logoutAction={path.to.logout}
        />
      ) : (
        <ItarEntityPendingBlock logoutAction={path.to.logout} />
      );
    } else {
      itarScreen = (
        <ItarUserCertification
          riderPdfPath={ITAR_RIDER_PDF_PATH}
          acknowledgeAction={path.to.acknowledge}
          logoutAction={path.to.logout}
        />
      );
    }
  }

  // Enforced-MFA gate. Rendered in place of the shell rather than redirected
  // to, so the enrollment API routes it calls are never themselves gated.
  // Ordered after ITAR: the export-control attestation is the legal gate and
  // must be answered first.
  const mfaScreen: ReactNode = mfaEnrollment.required ? (
    <MfaEnrollmentRequired
      enrollAction={path.to.mfaEnroll}
      verifyAction={path.to.mfaVerify}
      logoutAction={path.to.logout}
      controlledEnvironment={mfaEnrollment.controlledEnvironment}
      userName={`${user.firstName ?? ""} ${user.lastName ?? ""}`.trim()}
      avatarUrl={user.avatarUrl}
    />
  ) : null;

  return (
    <div className="h-[100dvh] flex flex-col">
      {/* Idle lock conceals the app (3.1.10). Not shown over the ITAR/MFA gates —
          the user has not fully entered the app there. */}
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
              printing:
                (companySettings?.printing as PrintingSettings | null) ?? null,
              printerRoutes,
              useMetric: Boolean(companySettings?.useMetric),
              printPath: path.to.manualPrint,
              settingsPath: path.to.printingSettings
            }}
          >
            <RealtimeDataProvider>
              <TooltipProvider>
                <div className="flex flex-col h-screen">
                  <Topbar />
                  <div className="flex flex-1 h-[calc(100vh-49px)] relative">
                    <PrimaryNavigation />
                    <main className="flex-1 overflow-y-auto scrollbar-hide border-l border-t bg-card sm:rounded-tl-2xl relative z-10">
                      <Outlet />
                    </main>
                  </div>
                </div>
                <TrainingPanel
                  training={training}
                  isOpen={isOpen}
                  onDismiss={dismiss}
                />
                <AgentRoot />
                {companySettings?.timeCardEnabled && (
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
              </TooltipProvider>
            </RealtimeDataProvider>
          </PrintingProvider>
        </CarbonProvider>
      )}
    </div>
  );
}
