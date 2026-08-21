import {
  assertIsPost,
  CarbonEdition,
  CONTROLLED_ENVIRONMENT,
  error,
  success
} from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getSamlSpUrls } from "@carbon/auth/sso.server";
import { ValidatedForm } from "@carbon/form";
import {
  Badge,
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
import { Edition } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, Link, redirect, useFetcher, useLoaderData } from "react-router";
import { Hidden, Input, Submit, TextArea } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { useFlags } from "~/hooks/useFlags";
import { useSettings } from "~/hooks/useSettings";
import {
  ssoConnectionValidator,
  updateRequireMfaSetting
} from "~/modules/settings";
import { getSsoConnection } from "~/modules/settings/settings.server";
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

  if (CarbonEdition !== Edition.Enterprise) {
    return {
      connection: null,
      acsUrl,
      metadataUrl,
      coveredUsers: [] as { id: string; name: string; email: string }[]
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

  // Informational: active/invited employees whose email domain is bound to
  // the connection. Existing members are linked automatically on their next
  // SSO sign-in — no re-invite is needed. Filtered in the query (no row cap):
  // `%@<domain>` is an exact-suffix match with a literal "@", so a covered
  // example.com never pulls in sub.example.com, mirroring the callback's
  // exact-domain check. The domain validator's [a-z0-9.-] charset means the
  // pattern can't carry ilike wildcards or break the .or() separator.
  let coveredUsers: { id: string; name: string; email: string }[] = [];
  if (connection.data) {
    const domains = connection.data.domains ?? [];
    if (domains.length > 0) {
      const covered = await client
        .from("employees")
        .select("id, name, email")
        .eq("companyId", companyId)
        .or(domains.map((domain) => `email.ilike.%@${domain}`).join(","));
      coveredUsers = (covered.data ?? []).map((employee) => ({
        id: employee.id ?? employee.email ?? "",
        name: employee.name ?? employee.email ?? "",
        email: employee.email ?? ""
      }));
    }
  }

  return {
    connection: connection.data,
    acsUrl,
    metadataUrl,
    coveredUsers
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    update: "settings"
  });
  const formData = await request.formData();

  const requireMfa = formData.get("enabled") === "true";
  const update = await updateRequireMfaSetting(client, companyId, requireMfa);
  if (update.error)
    return data(
      {},
      await flash(
        request,
        error(update.error, "Failed to update two-factor requirement")
      )
    );

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
  const { connection, acsUrl, metadataUrl, coveredUsers } =
    useLoaderData<typeof loader>();
  const { t } = useLingui();
  const permissions = usePermissions();
  const canEdit = permissions.can("update", "settings");
  const mfaFetcher = useFetcher<{}>();
  const settings = useSettings();
  const requireMfa = settings.requireMfa === true;
  const { isEnterprise } = useFlags();
  const [deactivateModalOpen, setDeactivateModalOpen] = useState(false);
  const deactivateFetcher = useFetcher<{}>();
  const requireSsoFetcher = useFetcher<{}>();

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

        {isEnterprise && (
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
                  </VStack>
                </CardContent>
                <CardFooter>
                  <Submit isDisabled={!canEdit}>
                    <Trans>Save</Trans>
                  </Submit>
                </CardFooter>
              </Card>
            </ValidatedForm>

            {connection && (
              <Card>
                <CardHeader>
                  <HStack className="justify-between items-center">
                    <div>
                      <CardTitle>
                        <Trans>Connection Status</Trans>
                      </CardTitle>
                      <CardDescription>
                        <Trans>
                          Users with these email domains sign in through your
                          identity provider.
                        </Trans>
                      </CardDescription>
                    </div>
                    <Badge variant="green">
                      <Trans>Active</Trans>
                    </Badge>
                  </HStack>
                </CardHeader>
                <CardContent>
                  <VStack spacing={4}>
                    <HStack className="flex-wrap gap-2">
                      {(connection.domains ?? []).map((domain) => (
                        <Badge key={domain} variant="secondary">
                          {domain}
                        </Badge>
                      ))}
                    </HStack>
                    <HStack className="w-full justify-between items-center">
                      <div>
                        <p className="text-sm font-medium">
                          <Trans>Require SSO</Trans>
                        </p>
                        <p className="text-sm text-muted-foreground">
                          <Trans>
                            Users on covered domains can sign in only with SSO;
                            magic link, Google, and passkeys are refused.
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
                            { intent: "requireSso", enabled: String(checked) },
                            { method: "post", action: path.to.sso }
                          )
                        }
                        disabled={
                          requireSsoFetcher.state !== "idle" || !canEdit
                        }
                        aria-label={t`Require SSO`}
                      />
                    </HStack>
                  </VStack>
                </CardContent>
                <CardFooter>
                  <Button
                    variant="destructive"
                    isDisabled={!canEdit}
                    onClick={() => setDeactivateModalOpen(true)}
                  >
                    <Trans>Deactivate</Trans>
                  </Button>
                </CardFooter>
              </Card>
            )}

            {connection && coveredUsers.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>
                    <Trans>Covered Users</Trans>
                  </CardTitle>
                  <CardDescription>
                    <Trans>
                      These existing members are covered by your registered
                      domains and will sign in with SSO automatically on their
                      next login — no re-invite is needed. People not yet in the
                      company still need an invite from the{" "}
                      <Link
                        to={path.to.employeeAccounts}
                        className="text-primary underline"
                      >
                        employee accounts page
                      </Link>
                      ; invite emails for these domains route to SSO
                      automatically.
                    </Trans>
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <VStack spacing={2}>
                    {coveredUsers.map((user) => (
                      <HStack key={user.id} className="w-full justify-between">
                        <span className="text-sm font-medium">{user.name}</span>
                        <span className="text-sm text-muted-foreground">
                          {user.email}
                        </span>
                      </HStack>
                    ))}
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
