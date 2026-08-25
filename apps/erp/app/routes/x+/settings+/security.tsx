import {
  assertIsPost,
  CONTROLLED_ENVIRONMENT,
  error,
  success
} from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import {
  getSamlSpUrls,
  getSsoConnection,
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
  Heading,
  HStack,
  Input as InputBase,
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
import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, Link, redirect, useFetcher, useLoaderData } from "react-router";
import { Hidden, Input, Submit, TextArea } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { useSettings } from "~/hooks/useSettings";
import {
  ssoConnectionValidator,
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
        error(connection.error, "Failed to load SSO connection")
      )
    );
  }

  return {
    ssoEnabled,
    connection: connection.data,
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

export default function Security() {
  const { ssoEnabled, connection, acsUrl, metadataUrl } =
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

  // A successful deactivation redirects and revalidates the loader, so the
  // connection disappears — close the confirm modal with it instead of
  // leaving it floating over the setup form. A failed deactivation returns
  // data (connection still present), so the modal stays open with the error
  // flash visible.
  useEffect(() => {
    if (!connection) setDeactivateModalOpen(false);
  }, [connection]);

  return (
    <ScrollArea className="w-full h-[calc(100dvh-49px)]">
      <VStack
        spacing={4}
        className="py-12 px-4 max-w-[60rem] h-full mx-auto gap-4"
      >
        <Heading size="h3">
          <Trans>Security</Trans>
        </Heading>
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
                      This is a controlled environment, so two-factor
                      authentication is required for everyone and cannot be
                      turned off.
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
                  CONTROLLED_ENVIRONMENT ||
                  mfaFetcher.state !== "idle" ||
                  !canEdit
                }
                aria-label={t`Require two-factor authentication`}
              />
            </HStack>
          </CardHeader>
        </Card>

        {ssoEnabled && (
          <>
            <Heading size="h3">
              <Trans>Single Sign-On</Trans>
            </Heading>

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
              <CardContent>
                <VStack spacing={4}>
                  <VStack spacing={1}>
                    <label className="text-sm font-medium">
                      <Trans>ACS URL</Trans>
                    </label>
                    <HStack className="w-full">
                      <InputBase value={acsUrl} isReadOnly />
                      <Copy text={acsUrl} />
                    </HStack>
                  </VStack>
                  <VStack spacing={1}>
                    <label className="text-sm font-medium">
                      <Trans>SP Metadata URL</Trans>
                    </label>
                    <HStack className="w-full">
                      <InputBase value={metadataUrl} isReadOnly />
                      <Copy text={metadataUrl} />
                    </HStack>
                  </VStack>
                </VStack>
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
                metadataXml: connection?.metadataXml ?? "",
                // The form field carries the comma-separated string; the
                // validator's transform turns it into the stored string array.
                domains: (connection?.domains?.join(", ") ??
                  "") as unknown as string[]
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
                <CardContent>
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
                    <Input
                      name="domains"
                      label={t`Email Domains`}
                      helperText={t`Comma-separated list of email domains, e.g. example.com, example.org`}
                    />
                    {connection && (
                      <HStack className="w-full justify-between items-center">
                        <div>
                          <p className="text-sm font-medium">
                            <Trans>Require SSO</Trans>
                          </p>
                          <p className="text-sm text-muted-foreground">
                            <Trans>
                              Users on covered domains can sign in only with
                              SSO; magic link, Google, and passkeys are refused.
                            </Trans>
                          </p>
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
                          aria-label={t`Require SSO`}
                        />
                      </HStack>
                    )}
                  </VStack>
                </CardContent>
                <CardFooter className="justify-between">
                  <Submit isDisabled={!canEdit}>
                    <Trans>Save</Trans>
                  </Submit>
                  {connection && (
                    <Button
                      variant="destructive"
                      isDisabled={!canEdit}
                      onClick={() => setDeactivateModalOpen(true)}
                    >
                      <Trans>Deactivate</Trans>
                    </Button>
                  )}
                </CardFooter>
              </Card>
            </ValidatedForm>

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
                        Are you sure you want to deactivate SSO? Users on your
                        registered domains will no longer be able to sign in
                        through your identity provider. This cannot be undone.
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
