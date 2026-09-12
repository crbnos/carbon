import {
  assertIsPost,
  CONTROLLED_ENVIRONMENT,
  error,
  success
} from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { requirePlan } from "@carbon/ee/plan.server";
import {
  getSamlSpUrls,
  getSsoConnection,
  getSsoDomains,
  getTxtRecord,
  isSsoEnabled
} from "@carbon/ee/sso.server";
import { ValidatedForm } from "@carbon/form";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Copy,
  cn,
  Heading,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  ScrollArea,
  Switch,
  VStack
} from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { type ReactNode, useEffect, useState } from "react";
import { LuShieldCheck } from "react-icons/lu";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, Link, redirect, useFetcher, useLoaderData } from "react-router";
import { Hidden, Input, Submit, TextArea } from "~/components/Form";
import { UpgradeOverlaySection } from "~/components/UpgradeOverlay";
import { usePermissions } from "~/hooks";
import { usePlanGate } from "~/hooks/usePlanGate";
import { useSettings } from "~/hooks/useSettings";
import {
  ssoConnectionValidator,
  ssoDomainValidator,
  updateRequireMfaSetting
} from "~/modules/settings";
import { sendMfaRequiredEmails } from "~/services/mfa-email.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Security`,
  to: path.to.security
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "settings",
    role: "employee"
  });

  // The SP URLs are un-prefixed on purpose: GoTrue self-declares its SP
  // entityID and ACS from API_EXTERNAL_URL (no /auth/v1) and validates each
  // assertion's Destination against that exact URL. Kong routes /sso/ for this
  // (kong.yml auth-v1-sso).
  const { acsUrl, metadataUrl } = getSamlSpUrls();

  // The whole SSO surface keys off isSsoEnabled() (Enterprise edition + `sso`
  // in AUTH_PROVIDERS) — the component gates the section on this flag rather
  // than on edition alone, so a deployment without the provider enabled never
  // shows a setup form whose action would refuse.
  const ssoEnabled = isSsoEnabled();
  if (!ssoEnabled) {
    return {
      ssoEnabled,
      connection: null,
      domains: [],
      acsUrl,
      metadataUrl
    };
  }

  const connection = await getSsoConnection(client, companyId);
  if (connection.error) {
    throw redirect(
      path.to.settings,
      await flash(
        request,
        error(connection.error, "Failed to load SAML SSO connection")
      )
    );
  }

  // Domain claims with their DNS challenge instructions. The token is not a
  // secret (once published it is world-readable in DNS), so shipping the
  // ready-to-copy record to the client is fine.
  let domains: {
    id: string;
    domain: string;
    status: string;
    txtHost: string;
    txtValue: string;
  }[] = [];
  if (connection.data) {
    const domainRows = await getSsoDomains(client, companyId);
    if (domainRows.error) {
      throw redirect(
        path.to.settings,
        await flash(
          request,
          error(domainRows.error, "Failed to load SAML SSO domains")
        )
      );
    }
    domains = (domainRows.data ?? [])
      .filter((row) => row.connectionId === connection.data?.id)
      .map((row) => {
        const txt = getTxtRecord(row.domain, row.verificationToken);
        return {
          id: row.id,
          domain: row.domain,
          status: row.status,
          txtHost: txt.host,
          txtValue: txt.value
        };
      });
  }

  return {
    ssoEnabled,
    connection: connection.data,
    domains,
    acsUrl,
    metadataUrl
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    update: "settings"
  });
  const formData = await request.formData();

  const requireMfa = formData.get("enabled") === "true";

  if (requireMfa) {
    await requirePlan({
      request,
      client,
      companyId,
      feature: "TWO_FACTOR",
      redirectTo: path.to.security,
      message: "Upgrade to Business to require two-factor authentication"
    });
  }

  // Read the stored value first: the switch re-submits on every flip, and a
  // toggle that lands on the value it already had must not re-announce.
  const previous = await client
    .from("companySettings")
    .select("requireMfa")
    .eq("id", companyId)
    .single();

  const update = await updateRequireMfaSetting(client, companyId, requireMfa);
  if (update.error)
    return data(
      {},
      await flash(
        request,
        error(update.error, "Failed to update two-factor requirement")
      )
    );

  // Only the off → on transition is news. If the prior read failed we don't
  // know it was a transition, so we stay quiet rather than mailing the company.
  //
  // CONTROLLED_ENVIRONMENT is checked separately because effective enforcement
  // is `CONTROLLED_ENVIRONMENT || requireMfa` (see the ERP/MES shell loaders),
  // and nothing ever writes the column in such a deployment — it stays false
  // while MFA is already mandatory. Without this guard the column would read as
  // a fresh off → on and the company would be told a requirement "now" applies
  // that has applied since the day it was deployed. Enforcement there is a
  // deployment fact, not an event, so there is nothing to announce.
  if (
    !CONTROLLED_ENVIRONMENT &&
    requireMfa &&
    previous.data?.requireMfa === false
  ) {
    await sendMfaRequiredEmails(getCarbonServiceRole(), companyId);
  }

  return data(
    {},
    await flash(
      request,
      success(
        requireMfa
          ? "Two-factor authentication is now required"
          : "Two-factor authentication is no longer required"
      )
    )
  );
}

function StatusDot({
  tone,
  children
}: {
  tone: "green" | "amber" | "gray";
  children: ReactNode;
}) {
  const toneClass = {
    green: "bg-emerald-500 shadow-[0_0_0_3px_rgb(16_185_129_/_0.15)]",
    amber: "bg-amber-500 shadow-[0_0_0_3px_rgb(245_158_11_/_0.15)]",
    gray: "bg-muted-foreground/40"
  }[tone];

  return (
    <span className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground">
      <span className={cn("size-2 rounded-full", toneClass)} />
      {children}
    </span>
  );
}

function ConnectionStatus({ active }: { active: boolean }) {
  return (
    <StatusDot tone={active ? "green" : "gray"}>
      {active ? <Trans>Active</Trans> : <Trans>Not configured</Trans>}
    </StatusDot>
  );
}

function CopyableField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1.5 w-full">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <div className="flex items-center gap-1 h-10 w-full rounded-md border border-input bg-muted/40 pl-3 pr-1">
        <span className="flex-1 truncate font-mono text-sm text-muted-foreground">
          {value}
        </span>
        <Copy text={value} />
      </div>
    </div>
  );
}

function SsoDomainRow({
  domain,
  canEdit
}: {
  domain: {
    id: string;
    domain: string;
    status: string;
    txtHost: string;
    txtValue: string;
  };
  canEdit: boolean;
}) {
  const { t } = useLingui();
  const fetcher = useFetcher<{}>();
  const isPending = domain.status !== "verified";
  const isBusy = fetcher.state !== "idle";
  const submitting = fetcher.formData?.get("intent");

  return (
    <div className="w-full rounded-md border border-border p-4">
      <HStack className="w-full justify-between items-center">
        <HStack spacing={2}>
          <span className="text-sm font-medium font-mono">{domain.domain}</span>
          <StatusDot tone={isPending ? "amber" : "green"}>
            {isPending ? <Trans>Pending</Trans> : <Trans>Verified</Trans>}
          </StatusDot>
        </HStack>
        <HStack spacing={2}>
          {isPending && (
            <fetcher.Form method="post" action={path.to.sso}>
              <input type="hidden" name="intent" value="verifyDomain" />
              <input type="hidden" name="domainId" value={domain.id} />
              <Button
                type="submit"
                variant="secondary"
                isLoading={isBusy && submitting === "verifyDomain"}
                isDisabled={!canEdit || isBusy}
              >
                <Trans>Verify</Trans>
              </Button>
            </fetcher.Form>
          )}
          <fetcher.Form method="post" action={path.to.sso}>
            <input type="hidden" name="intent" value="removeDomain" />
            <input type="hidden" name="domainId" value={domain.id} />
            <Button
              type="submit"
              variant="ghost"
              isLoading={isBusy && submitting === "removeDomain"}
              isDisabled={!canEdit || isBusy}
            >
              <Trans>Remove</Trans>
            </Button>
          </fetcher.Form>
        </HStack>
      </HStack>
      {isPending && (
        <VStack spacing={2} className="mt-4">
          <p className="text-sm text-muted-foreground">
            <Trans>
              Add this TXT record at your DNS host, then click Verify. DNS
              changes can take a few minutes to propagate.
            </Trans>
          </p>
          <p className="text-sm text-muted-foreground">
            <Trans>
              Your DNS provider may auto-append your domain to the record name —
              if so, enter only the part before it (e.g. _carbon-challenge plus
              any subdomain).
            </Trans>
          </p>
          <CopyableField label={t`Host`} value={domain.txtHost} />
          <CopyableField label={t`Value`} value={domain.txtValue} />
        </VStack>
      )}
    </div>
  );
}

export default function Security() {
  const { ssoEnabled, connection, domains, acsUrl, metadataUrl } =
    useLoaderData<typeof loader>();
  const { t } = useLingui();
  const permissions = usePermissions();
  const canEdit = permissions.can("update", "settings");
  const mfaFetcher = useFetcher<{}>();
  const settings = useSettings();
  const requireMfa = settings.requireMfa === true;
  const [deactivateModalOpen, setDeactivateModalOpen] = useState(false);
  const deactivateFetcher = useFetcher<{}>();
  const requireSsoFetcher = useFetcher<{}>();
  // The IdP form posts to the action-only /settings/sso route. Submitting
  // through a fetcher keeps that off the navigation stack — a plain form
  // submit is a pathname change, which Submit's unsaved-changes blocker
  // intercepts as "leaving the page".
  const connectionFetcher = useFetcher<{}>();
  const addDomainFetcher = useFetcher<{}>();
  const { isGated } = usePlanGate({ feature: "TWO_FACTOR" });
  // Gate only the 2FA enforcement card — the SSO section is edition-gated
  // separately (isSsoEnabled), so a plan-gated company must still reach it.
  const mfaGated = isGated && !CONTROLLED_ENVIRONMENT && !requireMfa;

  // A successful deactivation redirects and revalidates the loader, so the
  // connection disappears — close the confirm modal with it instead of
  // leaving it floating over the setup form. A failed deactivation returns
  // data (connection still present), so the modal stays open with the error
  // flash visible.
  useEffect(() => {
    if (!connection) setDeactivateModalOpen(false);
  }, [connection]);

  const twoFactorCard = (
    <Card>
      <CardHeader>
        <HStack className="justify-between items-center">
          <div>
            <CardTitle>
              <Trans>Two-Factor Authentication Enforcement</Trans>
            </CardTitle>
            <CardDescription>
              {CONTROLLED_ENVIRONMENT ? (
                <Trans>
                  This is a controlled environment, so two-factor authentication
                  is required for everyone and cannot be turned off.
                </Trans>
              ) : (
                <Trans>
                  Require an authenticator app before anyone can open this
                  company. Their other companies are unaffected. Visit the{" "}
                  <Link
                    to={path.to.employeeAccounts}
                    className="text-primary underline"
                  >
                    employee accounts page
                  </Link>{" "}
                  to see each person's status.
                </Trans>
              )}
            </CardDescription>
          </div>
          <Switch
            checked={CONTROLLED_ENVIRONMENT || requireMfa}
            onCheckedChange={(checked) =>
              mfaFetcher.submit(
                { enabled: String(checked) },
                { method: "post" }
              )
            }
            disabled={
              CONTROLLED_ENVIRONMENT || mfaFetcher.state !== "idle" || !canEdit
            }
            aria-label={t`Require two-factor authentication`}
          />
        </HStack>
      </CardHeader>
    </Card>
  );

  return (
    <ScrollArea className="w-full h-[calc(100dvh-var(--topbar-height)-var(--content-inset))]">
      <VStack
        spacing={4}
        className="py-12 px-4 max-w-[60rem] h-full mx-auto gap-8"
      >
        <div className="flex flex-col gap-1 w-full">
          <Heading size="h3">
            <Trans>Security</Trans>
          </Heading>
          <p className="text-sm text-muted-foreground text-pretty">
            <Trans>
              Manage authentication and sign-in requirements for your company.
            </Trans>
          </p>
        </div>

        <div className="flex flex-col gap-1 w-full">
          <Heading size="h3">
            <Trans>MFA</Trans>
          </Heading>
          <p className="text-sm text-muted-foreground text-pretty max-w-xl">
            <Trans>
              Require a second factor when members sign in to this company.
            </Trans>
          </p>
        </div>
        {mfaGated ? (
          <UpgradeOverlaySection
            icon={<LuShieldCheck className="size-6 text-muted-foreground" />}
            title={<Trans>Two-Factor Authentication Enforcement</Trans>}
            description={
              <Trans>
                Protect your company with advanced security controls like
                two-factor authentication enforcement.
              </Trans>
            }
          >
            {twoFactorCard}
          </UpgradeOverlaySection>
        ) : (
          twoFactorCard
        )}

        {ssoEnabled && (
          <>
            <div className="flex items-end justify-between gap-4 w-full">
              <div className="flex flex-col gap-1">
                <Heading size="h3">
                  <Trans>Single Sign-On</Trans>
                </Heading>
                <p className="text-sm text-muted-foreground text-pretty max-w-xl">
                  <Trans>
                    Let members sign in through your identity provider with
                    SAML.
                  </Trans>
                </p>
              </div>
              <ConnectionStatus active={Boolean(connection)} />
            </div>

            <Card>
              <CardHeader>
                <CardTitle>
                  <Trans>Service Provider Details</Trans>
                </CardTitle>
                <CardDescription>
                  <Trans>
                    Provide these URLs to your identity provider (Okta, Entra
                    ID, Google Workspace, etc.) when registering Carbon as a
                    SAML application.
                  </Trans>
                </CardDescription>
              </CardHeader>
              <CardContent className="gap-4">
                <CopyableField label={t`ACS URL`} value={acsUrl} />
                <CopyableField label={t`SP Metadata URL`} value={metadataUrl} />
              </CardContent>
            </Card>

            <ValidatedForm
              className="w-full"
              validator={ssoConnectionValidator}
              method="post"
              action={path.to.sso}
              fetcher={connectionFetcher}
              defaultValues={{
                metadataUrl: connection?.metadataUrl ?? "",
                metadataXml: connection?.metadataXml ?? ""
              }}
            >
              <Card>
                <CardHeader>
                  <CardTitle>
                    <Trans>Identity Provider</Trans>
                  </CardTitle>
                  <CardDescription>
                    <Trans>
                      Connect your identity provider by pasting either its
                      metadata URL or its raw metadata XML — exactly one of the
                      two.
                    </Trans>
                  </CardDescription>
                </CardHeader>
                <CardContent className="gap-6">
                  <Hidden name="intent" value="upsert" />
                  <VStack spacing={4}>
                    <Input
                      name="metadataUrl"
                      label={t`IdP Metadata URL`}
                      helperText={t`The SAML metadata URL published by your identity provider`}
                    />
                    <TextArea
                      name="metadataXml"
                      label={t`IdP Metadata XML`}
                      placeholder={t`Paste the metadata XML if your identity provider does not publish a metadata URL`}
                    />
                  </VStack>
                  {connection && (
                    <div className="flex items-center justify-between gap-4 border-t border-border pt-6">
                      <div className="flex flex-col gap-0.5 max-w-md">
                        <p className="text-sm font-medium text-foreground">
                          <Trans>Require SAML SSO</Trans>
                        </p>
                        <p className="text-sm text-muted-foreground text-pretty">
                          <Trans>
                            Users on covered domains can sign in only with SAML
                            SSO; magic link, Google, and passkeys are refused.
                          </Trans>
                        </p>
                        {connection.domains.length === 0 && (
                          <p className="text-sm text-muted-foreground text-pretty">
                            <Trans>
                              This has no effect until an email domain is
                              verified below.
                            </Trans>
                          </p>
                        )}
                      </div>
                      {/* The connection loaded here is active by definition
                          (getSsoConnection filters active = true), so the
                          switch is enabled whenever a connection renders. */}
                      <Switch
                        checked={connection.requireSso === true}
                        onCheckedChange={(checked) =>
                          requireSsoFetcher.submit(
                            {
                              intent: "requireSso",
                              enabled: String(checked)
                            },
                            { method: "post", action: path.to.sso }
                          )
                        }
                        disabled={
                          requireSsoFetcher.state !== "idle" || !canEdit
                        }
                        aria-label={t`Require SAML SSO`}
                      />
                    </div>
                  )}
                </CardContent>
                <CardFooter
                  className={connection ? "justify-between" : "justify-end"}
                >
                  {connection && (
                    <Button
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      isDisabled={!canEdit}
                      onClick={() => setDeactivateModalOpen(true)}
                    >
                      <Trans>Deactivate</Trans>
                    </Button>
                  )}
                  <Submit isDisabled={!canEdit}>
                    {connection ? (
                      <Trans>Save changes</Trans>
                    ) : (
                      <Trans>Connect</Trans>
                    )}
                  </Submit>
                </CardFooter>
              </Card>
            </ValidatedForm>

            {connection && (
              <Card>
                <CardHeader>
                  <CardTitle>
                    <Trans>Email Domains</Trans>
                  </CardTitle>
                  <CardDescription>
                    <Trans>
                      Prove ownership of each email domain with a DNS TXT record
                      before it can route SAML SSO sign-ins. Add the record at
                      DNS host, then click Verify — only verified domains
                      participate in single sign-on.
                    </Trans>
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <VStack spacing={4}>
                    {domains.map((domain) => (
                      <SsoDomainRow
                        key={domain.id}
                        domain={domain}
                        canEdit={canEdit}
                      />
                    ))}
                    <ValidatedForm
                      className="w-full"
                      validator={ssoDomainValidator}
                      method="post"
                      action={path.to.sso}
                      defaultValues={{ domain: "" }}
                      fetcher={addDomainFetcher}
                      resetAfterSubmit
                    >
                      <Hidden name="intent" value="addDomain" />
                      <div className="flex w-full items-end gap-2">
                        <div className="flex-1">
                          <Input
                            name="domain"
                            label={t`Add a domain`}
                            placeholder="example.com"
                          />
                        </div>
                        <Submit isDisabled={!canEdit} withBlocker={false}>
                          <Trans>Add</Trans>
                        </Submit>
                      </div>
                    </ValidatedForm>
                  </VStack>
                </CardContent>
              </Card>
            )}

            {deactivateModalOpen && (
              <Modal
                open
                onOpenChange={(open) => {
                  if (!open) setDeactivateModalOpen(false);
                }}
              >
                <ModalOverlay />
                <ModalContent>
                  <ModalHeader>
                    <ModalTitle>
                      <Trans>Deactivate Single Sign-On</Trans>
                    </ModalTitle>
                  </ModalHeader>
                  <ModalBody>
                    <p className="text-sm text-muted-foreground">
                      <Trans>
                        Are you sure you want to deactivate SAML SSO? Users on
                        your registered domains will no longer be able to sign
                        in through your identity provider. This cannot be
                        undone.
                      </Trans>
                    </p>
                  </ModalBody>
                  <ModalFooter>
                    <Button
                      variant="secondary"
                      onClick={() => setDeactivateModalOpen(false)}
                    >
                      <Trans>Cancel</Trans>
                    </Button>
                    <deactivateFetcher.Form method="post" action={path.to.sso}>
                      <input type="hidden" name="intent" value="deactivate" />
                      <Button
                        variant="destructive"
                        type="submit"
                        isLoading={deactivateFetcher.state !== "idle"}
                        isDisabled={deactivateFetcher.state !== "idle"}
                      >
                        <Trans>Deactivate</Trans>
                      </Button>
                    </deactivateFetcher.Form>
                  </ModalFooter>
                </ModalContent>
              </Modal>
            )}
          </>
        )}
      </VStack>
    </ScrollArea>
  );
}
