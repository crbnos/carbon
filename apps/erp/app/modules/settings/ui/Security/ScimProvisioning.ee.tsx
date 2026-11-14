// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { docUrl } from "@carbon/content/links";
import { ValidatedForm } from "@carbon/form";
import { useAction } from "@carbon/query";
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
  IconButton,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  Select as PlainSelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { type ReactNode, useRef, useState } from "react";
import { LuArrowDown, LuArrowUp, LuUsers } from "react-icons/lu";
import { useFetcher } from "react-router";
import { DateTime } from "~/components";
import { Hidden, Location, Select, Submit } from "~/components/Form";
import { ConfirmDelete } from "~/components/Modals";
import { UpgradeOverlaySection } from "~/components/UpgradeOverlay";
import { usePlanGate } from "~/hooks/usePlanGate";
import {
  SCIM_NOT_MAPPED,
  scimConnectionValidator
} from "~/modules/settings/settings.models";
import { path } from "~/utils/path";
import { CopyableField, StatusDot } from "./SecurityFields";

export type ScimProvisioningData = {
  connection: {
    id: string;
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
  const [regenerateOpen, setRegenerateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // The raw token comes back once, from the fetcher that made it. Closing the
  // modal remembers every dismissed token rather than copying one to state:
  // both fetchers keep their data, so a later setup's token must not hide
  // behind an earlier regenerated one.
  const [dismissedTokens, setDismissedTokens] = useState<string[]>([]);
  const shownToken =
    [regenerateFetcher.data?.token, createFetcher.data?.token].find(
      (candidate): candidate is string =>
        !!candidate && !dismissedTokens.includes(candidate)
    ) ?? null;
  const dismissToken = () => {
    if (shownToken) setDismissedTokens((tokens) => [...tokens, shownToken]);
  };
  // The modal stays mounted so it animates closed; keep the token on screen
  // while it does, instead of an empty field.
  const lastShownToken = useRef<string | null>(null);
  if (shownToken) lastShownToken.current = shownToken;

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
        defaultEmployeeTypeId: "",
        defaultLocationId: ""
      }}
    >
      <Hidden name="intent" value="create" />
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
          <VStack spacing={4}>
            <Select
              name="defaultEmployeeTypeId"
              label={t`Default employee type`}
              placeholder={t`Select`}
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
            defaultEmployeeTypeId: connection.defaultEmployeeTypeId,
            defaultLocationId: connection.defaultLocationId
          }}
        >
          <Hidden name="intent" value="update" />
          <Card>
            <CardHeader>
              <CardTitle>
                <Trans>SCIM Connection</Trans>
              </CardTitle>
              <CardDescription>
                <Trans>
                  Your identity provider adds, updates and removes the members
                  it manages.
                </Trans>{" "}
                <a
                  href={docUrl("docs/reference/scim-provisioning")}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  <Trans>How SCIM works</Trans>
                </a>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <VStack spacing={4}>
                <CopyableField label={t`SCIM base URL`} value={baseUrl} />
                <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-3">
                  <Fact label={t`Token`}>
                    <span className="font-mono">
                      scim_•••{connection.tokenPreview}
                    </span>
                  </Fact>
                  <Fact label={t`Provisioned members`}>
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

      {/* Shown once the identity provider has sent a group: a company that
          does not map groups has nothing to do here. */}
      {connection && (scim?.groups.length ?? 0) > 0 && (
        <GroupMappingsCard
          groups={scim?.groups ?? []}
          employeeTypeOptions={employeeTypeOptions}
          canEdit={canEdit && !isGated}
        />
      )}

      <Modal
        open={shownToken !== null}
        onOpenChange={(open) => {
          if (!open) dismissToken();
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
                  Enter the base URL and this token in your identity provider's
                  provisioning settings. This token is shown once.
                </Trans>
              </p>
              <CopyableField label={t`SCIM base URL`} value={baseUrl} />
              <CopyableField
                label={t`Token`}
                value={shownToken ?? lastShownToken.current ?? ""}
              />
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button onClick={dismissToken}>
              <Trans>Done</Trans>
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal
        open={regenerateOpen}
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

      <ConfirmDelete
        isOpen={deleteOpen}
        action={path.to.scim}
        fields={{ intent: "delete" }}
        name={t`SCIM Provisioning`}
        title={t`Turn off SCIM provisioning`}
        text={t`Your identity provider can no longer add or remove members. Members it provisioned stay as they are, and setting SCIM up again picks up where it left off.`}
        deleteText={t`Turn off`}
        onCancel={() => setDeleteOpen(false)}
        onSubmit={() => setDeleteOpen(false)}
      />
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

type ScimGroup = ScimProvisioningData["groups"][number];

function GroupMappingsCard({
  groups,
  employeeTypeOptions,
  canEdit
}: {
  /** In the order they win (the loader sorts them). */
  groups: ScimGroup[];
  employeeTypeOptions: { value: string; label: string }[];
  canEdit: boolean;
}) {
  // Only the unsaved edits live in state; the groups come from the loader.
  const [types, setTypes] = useState<Record<string, string | null>>({});
  const [order, setOrder] = useState<string[] | null>(null);
  const discard = () => {
    setTypes({});
    setOrder(null);
  };
  const saveFetcher = useAction<{ success?: boolean }>({
    onSuccess: discard,
    // The action's flash already says what failed; keep the edits to retry.
    onError: () => {}
  });

  const typeOf = (group: ScimGroup) =>
    group.id in types ? (types[group.id] ?? null) : group.employeeTypeId;
  const byId = new Map(groups.map((group) => [group.id, group]));
  const savedOrder = groups
    .filter((group) => group.employeeTypeId !== null)
    .map((group) => group.id);
  const baseOrder = order ?? savedOrder;
  // Mapped groups in the order they win; a newly mapped group goes last.
  const mapped = [
    ...baseOrder.flatMap((id) => {
      const group = byId.get(id);
      return group && typeOf(group) !== null ? [group] : [];
    }),
    ...groups.filter(
      (group) => typeOf(group) !== null && !baseOrder.includes(group.id)
    )
  ];
  // Unmapped groups by name: their place in the order means nothing.
  const unmapped = groups
    .filter((group) => typeOf(group) === null)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  const isDirty =
    groups.some((group) => typeOf(group) !== group.employeeTypeId) ||
    mapped.map((group) => group.id).join() !== savedOrder.join();
  const isSaving = saveFetcher.isPending;

  const move = (position: number, direction: "up" | "down") => {
    const next = mapped.map((group) => group.id);
    const target = direction === "up" ? position - 1 : position + 1;
    const moving = next[position];
    const other = next[target];
    if (!moving || !other) return;
    next[position] = other;
    next[target] = moving;
    setOrder(next);
  };

  const save = () =>
    saveFetcher.submit(
      {
        intent: "saveGroupMappings",
        groups: JSON.stringify(
          [...mapped, ...unmapped].map((group) => ({
            groupId: group.id,
            employeeTypeId: typeOf(group)
          }))
        )
      },
      { method: "post", action: path.to.scim }
    );

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Group Mappings</Trans>
        </CardTitle>
        <CardDescription>
          <Trans>
            Choose the employee type each group gives its members. If someone is
            in more than one group, the higher one wins.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex w-full flex-col divide-y divide-border">
          {[...mapped, ...unmapped].map((group, index) => (
            <GroupMappingRow
              key={group.id}
              group={group}
              value={typeOf(group) ?? SCIM_NOT_MAPPED}
              onChange={(value) =>
                setTypes((current) => ({
                  ...current,
                  [group.id]: value === SCIM_NOT_MAPPED ? null : value
                }))
              }
              position={index < mapped.length ? index : null}
              mappedCount={mapped.length}
              onMove={move}
              employeeTypeOptions={employeeTypeOptions}
              isDisabled={!canEdit || isSaving}
            />
          ))}
        </div>
      </CardContent>
      <CardFooter className="justify-end">
        <HStack spacing={2}>
          <Button
            variant="secondary"
            isDisabled={!isDirty || isSaving}
            onClick={discard}
          >
            <Trans>Cancel</Trans>
          </Button>
          <Button
            isDisabled={!canEdit || !isDirty || isSaving}
            isLoading={isSaving}
            onClick={save}
          >
            <Trans>Save changes</Trans>
          </Button>
        </HStack>
      </CardFooter>
    </Card>
  );
}

function GroupMappingRow({
  group,
  value,
  onChange,
  position,
  mappedCount,
  onMove,
  employeeTypeOptions,
  isDisabled
}: {
  group: ScimGroup;
  value: string;
  onChange: (value: string) => void;
  /** The group's place among the mapped groups; null when it is unmapped. */
  position: number | null;
  mappedCount: number;
  onMove: (position: number, direction: "up" | "down") => void;
  employeeTypeOptions: { value: string; label: string }[];
  isDisabled: boolean;
}) {
  const { t } = useLingui();

  return (
    <div className="flex w-full flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium">
          {group.displayName}
        </span>
        <span className="text-xs text-muted-foreground">
          {group.memberCount === 1 ? (
            <Trans>1 member</Trans>
          ) : (
            <Trans>{group.memberCount} members</Trans>
          )}
        </span>
      </div>
      <HStack spacing={1}>
        {position !== null && mappedCount > 1 && (
          <>
            <IconButton
              aria-label={t`Move up`}
              icon={<LuArrowUp />}
              variant="ghost"
              size="sm"
              isDisabled={isDisabled || position === 0}
              onClick={() => onMove(position, "up")}
            />
            <IconButton
              aria-label={t`Move down`}
              icon={<LuArrowDown />}
              variant="ghost"
              size="sm"
              isDisabled={isDisabled || position === mappedCount - 1}
              onClick={() => onMove(position, "down")}
            />
          </>
        )}
        <PlainSelect
          value={value}
          disabled={isDisabled}
          onValueChange={onChange}
        >
          <SelectTrigger
            className="w-full sm:w-56"
            aria-label={t`Employee type for ${group.displayName}`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SCIM_NOT_MAPPED}>
              <Trans>Not mapped</Trans>
            </SelectItem>
            {employeeTypeOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </PlainSelect>
      </HStack>
    </div>
  );
}
