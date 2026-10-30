// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { ValidatedForm } from "@carbon/form";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Heading,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { type ReactNode, useState } from "react";
import { LuUsers } from "react-icons/lu";
import { useFetcher } from "react-router";
import { DateTime } from "~/components";
import { Hidden, Location, Number, Select, Submit } from "~/components/Form";
import { UpgradeOverlaySection } from "~/components/UpgradeOverlay";
import { usePlanGate } from "~/hooks/usePlanGate";
import {
  SCIM_NOT_MAPPED,
  scimConnectionValidator,
  scimGroupMappingValidator,
  scimIdentityProviders
} from "~/modules/settings/settings.models";
import { path } from "~/utils/path";
import { CopyableField, StatusDot } from "./SecurityFields";

export type ScimProvisioningData = {
  connection: {
    id: string;
    identityProvider: (typeof scimIdentityProviders)[number];
    tokenPreview: string;
    defaultEmployeeTypeId: string;
    defaultLocationId: string;
    lastRequestAt: string | null;
  };
  groups: {
    id: string;
    displayName: string;
    employeeTypeId: string | null;
    priority: number;
    memberCount: number;
  }[];
  activeCount: number;
};

type ScimProvisioningProps = {
  scim: ScimProvisioningData | null;
  baseUrl: string;
  employeeTypes: { id: string; name: string }[];
  canEdit: boolean;
};

type TokenResponse = { token: string | null };

const identityProviderOptions = scimIdentityProviders.map((provider) => ({
  value: provider,
  label: provider
}));

export default function ScimProvisioning({
  scim,
  baseUrl,
  employeeTypes,
  canEdit
}: ScimProvisioningProps) {
  const { t } = useLingui();
  const { isGated } = usePlanGate({ feature: "SCIM" });
  const createFetcher = useFetcher<TokenResponse>();
  const regenerateFetcher = useFetcher<TokenResponse>();
  const updateFetcher = useFetcher<TokenResponse>();
  const deleteFetcher = useFetcher<TokenResponse>();
  const [regenerateOpen, setRegenerateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // The raw token comes back once, from the fetcher that made it. Closing the
  // modal remembers which token was dismissed rather than copying it to state.
  const token = regenerateFetcher.data?.token ?? createFetcher.data?.token;
  const [dismissedToken, setDismissedToken] = useState<string | null>(null);
  const shownToken = token && token !== dismissedToken ? token : null;

  const employeeTypeOptions = employeeTypes.map((type) => ({
    value: type.id,
    label: type.name
  }));
  const connection = scim?.connection ?? null;

  const header = (
    <div className="flex items-end justify-between gap-4 w-full">
      <div className="flex flex-col gap-1">
        <Heading size="h3">
          <Trans>Provisioning</Trans>
        </Heading>
        <p className="text-sm text-muted-foreground text-pretty max-w-xl">
          <Trans>
            Let your identity provider add, update and remove members with SCIM.
          </Trans>
        </p>
      </div>
      <StatusDot tone={connection ? "green" : "gray"}>
        {connection ? <Trans>Active</Trans> : <Trans>Not configured</Trans>}
      </StatusDot>
    </div>
  );

  const setupCard = (
    <ValidatedForm
      className="w-full"
      validator={scimConnectionValidator}
      method="post"
      action={path.to.scim}
      fetcher={createFetcher}
      defaultValues={{
        identityProvider: "Okta",
        defaultEmployeeTypeId: "",
        defaultLocationId: ""
      }}
    >
      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Set up SCIM</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>
              Your identity provider creates members with the default employee
              type and location below. Map its groups to employee types after it
              pushes them.
            </Trans>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Hidden name="intent" value="create" />
          <VStack spacing={4}>
            <Select
              name="identityProvider"
              label={t`Identity provider`}
              options={identityProviderOptions}
            />
            <Select
              name="defaultEmployeeTypeId"
              label={t`Default employee type`}
              options={employeeTypeOptions}
            />
            <Location name="defaultLocationId" label={t`Default location`} />
          </VStack>
        </CardContent>
        <CardFooter className="justify-end">
          <Submit isDisabled={!canEdit || isGated} withBlocker={false}>
            <Trans>Generate token</Trans>
          </Submit>
        </CardFooter>
      </Card>
    </ValidatedForm>
  );

  return (
    <>
      {header}

      {!connection && isGated && (
        <UpgradeOverlaySection
          icon={<LuUsers className="size-6 text-muted-foreground" />}
          title={<Trans>SCIM Provisioning</Trans>}
          description={
            <Trans>
              Add and remove members automatically from Okta or Microsoft Entra
              ID, so people your IT team offboards lose access to Carbon.
            </Trans>
          }
        >
          {setupCard}
        </UpgradeOverlaySection>
      )}

      {!connection && !isGated && setupCard}

      {connection && (
        <ValidatedForm
          className="w-full"
          validator={scimConnectionValidator}
          method="post"
          action={path.to.scim}
          fetcher={updateFetcher}
          defaultValues={{
            identityProvider: connection.identityProvider,
            defaultEmployeeTypeId: connection.defaultEmployeeTypeId,
            defaultLocationId: connection.defaultLocationId
          }}
        >
          <Card>
            <CardHeader>
              <CardTitle>
                <Trans>SCIM Connection</Trans>
              </CardTitle>
              <CardDescription>
                <Trans>
                  Your identity provider owns each provisioned member's name,
                  active state and, for mapped groups, employee type. Changes
                  made here are overwritten on its next update. Deactivating a
                  member removes them from this company, deletes their API keys
                  here, and ends their sessions when they have no other company.
                </Trans>
              </CardDescription>
            </CardHeader>
            <CardContent className="gap-6">
              <Hidden name="intent" value="update" />
              <VStack spacing={4}>
                <CopyableField label={t`SCIM base URL`} value={baseUrl} />
                <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-3">
                  <Fact label={t`Token`}>
                    <span className="font-mono">
                      scim_•••{connection.tokenPreview}
                    </span>
                  </Fact>
                  <Fact label={t`Active members`}>
                    {scim?.activeCount ?? 0}
                  </Fact>
                  <Fact label={t`Last request`}>
                    {connection.lastRequestAt ? (
                      <DateTime
                        value={connection.lastRequestAt}
                        variant="relative"
                      />
                    ) : (
                      <Trans>Never</Trans>
                    )}
                  </Fact>
                </div>
                <Select
                  name="identityProvider"
                  label={t`Identity provider`}
                  options={identityProviderOptions}
                />
                <Select
                  name="defaultEmployeeTypeId"
                  label={t`Default employee type`}
                  helperText={t`Members in no mapped group get this type`}
                  options={employeeTypeOptions}
                />
                <Location
                  name="defaultLocationId"
                  label={t`Default location`}
                />
              </VStack>
            </CardContent>
            <CardFooter className="justify-between">
              <Button
                variant="ghost"
                className="text-destructive hover:text-destructive"
                isDisabled={!canEdit}
                onClick={() => setDeleteOpen(true)}
              >
                <Trans>Turn off</Trans>
              </Button>
              <HStack spacing={2}>
                <Button
                  variant="secondary"
                  isDisabled={!canEdit || isGated}
                  onClick={() => setRegenerateOpen(true)}
                >
                  <Trans>Regenerate token</Trans>
                </Button>
                <Submit isDisabled={!canEdit || isGated}>
                  <Trans>Save changes</Trans>
                </Submit>
              </HStack>
            </CardFooter>
          </Card>
        </ValidatedForm>
      )}

      {connection && (
        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Group Mappings</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>
                Map each group your identity provider pushes to an employee
                type. A member of several mapped groups gets the type of the
                lowest priority.
              </Trans>
            </CardDescription>
          </CardHeader>
          <CardContent>
            {(scim?.groups.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground">
                <Trans>
                  No groups yet. Push groups from your identity provider to map
                  them to employee types.
                </Trans>
              </p>
            ) : (
              <VStack spacing={4}>
                {scim?.groups.map((group) => (
                  <GroupMappingRow
                    key={group.id}
                    group={group}
                    employeeTypeOptions={employeeTypeOptions}
                    canEdit={canEdit && !isGated}
                  />
                ))}
              </VStack>
            )}
          </CardContent>
        </Card>
      )}

      {shownToken && (
        <Modal
          open
          onOpenChange={(open) => {
            if (!open) setDismissedToken(shownToken);
          }}
        >
          <ModalOverlay />
          <ModalContent>
            <ModalHeader>
              <ModalTitle>
                <Trans>Your SCIM token</Trans>
              </ModalTitle>
            </ModalHeader>
            <ModalBody>
              <VStack spacing={4}>
                <p className="text-sm text-muted-foreground">
                  <Trans>
                    Enter the base URL and this token in your identity
                    provider's provisioning settings. This token is shown once.
                  </Trans>
                </p>
                <CopyableField label={t`SCIM base URL`} value={baseUrl} />
                <CopyableField label={t`Token`} value={shownToken} />
              </VStack>
            </ModalBody>
            <ModalFooter>
              <Button onClick={() => setDismissedToken(shownToken)}>
                <Trans>Done</Trans>
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      )}

      {regenerateOpen && (
        <Modal
          open
          onOpenChange={(open) => {
            if (!open) setRegenerateOpen(false);
          }}
        >
          <ModalOverlay />
          <ModalContent>
            <ModalHeader>
              <ModalTitle>
                <Trans>Regenerate SCIM token</Trans>
              </ModalTitle>
            </ModalHeader>
            <ModalBody>
              <p className="text-sm text-muted-foreground">
                <Trans>
                  The current token stops working at once. Provisioning stops
                  until you enter the new token in your identity provider.
                </Trans>
              </p>
            </ModalBody>
            <ModalFooter>
              <Button
                variant="secondary"
                onClick={() => setRegenerateOpen(false)}
              >
                <Trans>Cancel</Trans>
              </Button>
              <regenerateFetcher.Form
                method="post"
                action={path.to.scim}
                onSubmit={() => setRegenerateOpen(false)}
              >
                <input type="hidden" name="intent" value="regenerate" />
                <Button
                  type="submit"
                  isLoading={regenerateFetcher.state !== "idle"}
                  isDisabled={regenerateFetcher.state !== "idle"}
                >
                  <Trans>Regenerate</Trans>
                </Button>
              </regenerateFetcher.Form>
            </ModalFooter>
          </ModalContent>
        </Modal>
      )}

      {deleteOpen && (
        <Modal
          open
          onOpenChange={(open) => {
            if (!open) setDeleteOpen(false);
          }}
        >
          <ModalOverlay />
          <ModalContent>
            <ModalHeader>
              <ModalTitle>
                <Trans>Turn off SCIM provisioning</Trans>
              </ModalTitle>
            </ModalHeader>
            <ModalBody>
              <p className="text-sm text-muted-foreground">
                <Trans>
                  Your identity provider can no longer add or remove members,
                  and the group mappings are deleted. Members it provisioned
                  stay in this company as they are.
                </Trans>
              </p>
            </ModalBody>
            <ModalFooter>
              <Button variant="secondary" onClick={() => setDeleteOpen(false)}>
                <Trans>Cancel</Trans>
              </Button>
              <deleteFetcher.Form method="post" action={path.to.scim}>
                <input type="hidden" name="intent" value="delete" />
                <Button
                  variant="destructive"
                  type="submit"
                  isLoading={deleteFetcher.state !== "idle"}
                  isDisabled={deleteFetcher.state !== "idle"}
                >
                  <Trans>Turn off</Trans>
                </Button>
              </deleteFetcher.Form>
            </ModalFooter>
          </ModalContent>
        </Modal>
      )}
    </>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="text-sm text-foreground">{children}</span>
    </div>
  );
}

function GroupMappingRow({
  group,
  employeeTypeOptions,
  canEdit
}: {
  group: ScimProvisioningData["groups"][number];
  employeeTypeOptions: { value: string; label: string }[];
  canEdit: boolean;
}) {
  const { t } = useLingui();
  const fetcher = useFetcher<TokenResponse>();

  return (
    <ValidatedForm
      className="w-full rounded-md border border-border p-4 max-md:border-0 max-md:p-0 max-md:rounded-none"
      validator={scimGroupMappingValidator}
      method="post"
      action={path.to.scim}
      fetcher={fetcher}
      defaultValues={{
        groupId: group.id,
        employeeTypeId: group.employeeTypeId ?? SCIM_NOT_MAPPED,
        priority: group.priority
      }}
    >
      <Hidden name="intent" value="mapGroup" />
      <Hidden name="groupId" value={group.id} />
      <VStack spacing={3}>
        <HStack className="w-full justify-between">
          <span className="text-sm font-medium">{group.displayName}</span>
          <span className="text-xs text-muted-foreground">
            {group.memberCount === 1 ? (
              <Trans>1 member</Trans>
            ) : (
              <Trans>{group.memberCount} members</Trans>
            )}
          </span>
        </HStack>
        <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Select
              name="employeeTypeId"
              label={t`Employee type`}
              options={[
                { value: SCIM_NOT_MAPPED, label: t`Not mapped` },
                ...employeeTypeOptions
              ]}
            />
          </div>
          <div className="sm:w-32">
            <Number
              name="priority"
              label={t`Priority`}
              minValue={0}
              maxValue={1000}
            />
          </div>
          <Submit isDisabled={!canEdit} withBlocker={false}>
            <Trans>Save</Trans>
          </Submit>
        </div>
      </VStack>
    </ValidatedForm>
  );
}
