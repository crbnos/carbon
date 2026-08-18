import { Combobox, Submit, ValidatedForm } from "@carbon/form";
import {
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Spinner,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { LuArrowRight, LuLink, LuSparkles } from "react-icons/lu";
import { useFetcher } from "react-router";
import { usePermissions } from "~/hooks";
import { accountMappingUpsertValidator } from "~/modules/settings/settings.models";

/**
 * Local structural mirrors of @carbon/ee/accounting's AccountMapping /
 * UnmappedPostingAccount / AccountMatchProposal. Deliberately NOT imported
 * (even type-only) to keep this component's type graph light: marginal
 * additions around the settings module push unrelated supabase
 * select-string parses over TS2589's instantiation-depth limit (see
 * SyncActivity.tsx and the note in ./index.ts — this component isn't
 * barrel-exported for the same reason). The route's loader passes real
 * service rows, so any drift fails typecheck there.
 */
export type AccountMappingChartAccount = {
  id: string;
  code: string;
  name: string;
};

export type AccountMappingRow = {
  id: string;
  accountId: string;
  accountNumber: string | null;
  accountName: string | null;
  externalId: string | null;
  externalCode: string | null;
  externalName: string | null;
};

export type UnmappedAccountRow = {
  id: string;
  number: string | null;
  name: string;
};

export type AccountMatchProposalRow = {
  accountId: string;
  accountNumber: string;
  accountName: string;
  externalId: string;
  externalCode: string;
  externalName: string | null;
};

type AccountMappingProps = {
  /** Shared tab bar, rendered at the top of this tab's body card. */
  tabs?: ReactNode;
  mappings: AccountMappingRow[];
  unmapped: UnmappedAccountRow[];
  chart: AccountMappingChartAccount[];
  proposals: AccountMatchProposalRow[];
};

export function AccountMapping({
  tabs,
  mappings,
  unmapped,
  chart,
  proposals
}: AccountMappingProps) {
  const permissions = usePermissions();
  const canUpdate = permissions.can("update", "settings");
  const [showMatchDrawer, setShowMatchDrawer] = useState(false);
  const [showAiModal, setShowAiModal] = useState(false);

  const chartById = useMemo(
    () => new Map(chart.map((account) => [account.id, account])),
    [chart]
  );
  const chartOptions = useMemo(
    () =>
      chart.map((account) => ({
        value: account.id,
        label: `${account.code} - ${account.name}`
      })),
    [chart]
  );

  return (
    <>
      <DrawerBody className="gap-6">
        {tabs}
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">
            <Trans>
              Map Carbon accounts to the provider's chart of accounts. Posted
              journals push using the mapped provider account code.
            </Trans>
          </p>
          {chart.length > 0 && (
            <HStack spacing={2}>
              {unmapped.length > 0 && (
                <Button
                  size="sm"
                  variant="secondary"
                  leftIcon={<LuSparkles />}
                  isDisabled={!canUpdate}
                  onClick={() => setShowAiModal(true)}
                >
                  <Trans>Suggest with AI</Trans>
                </Button>
              )}
              <Button
                size="sm"
                variant="secondary"
                leftIcon={<LuLink />}
                onClick={() => setShowMatchDrawer(true)}
              >
                <Trans>Match by code</Trans>
              </Button>
            </HStack>
          )}
        </div>

        <MappingSection
          title={<Trans>Unmapped accounts</Trans>}
          description={
            <Trans>
              Accounts referenced by posting defaults or journal history that
              have no provider mapping yet.
            </Trans>
          }
          count={unmapped.length}
          emptyMessage={<Trans>All posting accounts are mapped</Trans>}
        >
          {unmapped.map((account) => (
            <AccountMappingRowForm
              key={account.id}
              accountId={account.id}
              accountNumber={account.number}
              accountName={account.name}
              currentExternalId={null}
              currentExternalCode={null}
              currentExternalName={null}
              chartById={chartById}
              chartOptions={chartOptions}
              canUpdate={canUpdate}
            />
          ))}
        </MappingSection>

        <MappingSection
          title={<Trans>Mapped accounts</Trans>}
          description={
            <Trans>
              Existing mappings. Pick a different provider account to re-map.
            </Trans>
          }
          count={mappings.length}
          emptyMessage={<Trans>No accounts mapped yet</Trans>}
        >
          {mappings.map((mapping) => (
            <AccountMappingRowForm
              key={mapping.id}
              accountId={mapping.accountId}
              accountNumber={mapping.accountNumber}
              accountName={mapping.accountName}
              currentExternalId={mapping.externalId}
              currentExternalCode={mapping.externalCode}
              currentExternalName={mapping.externalName}
              chartById={chartById}
              chartOptions={chartOptions}
              canUpdate={canUpdate}
            />
          ))}
        </MappingSection>
      </DrawerBody>

      {showMatchDrawer && (
        <MatchByCodeDrawer
          proposals={proposals}
          canUpdate={canUpdate}
          onClose={() => setShowMatchDrawer(false)}
        />
      )}

      {showAiModal && (
        <AiSuggestModal
          unmapped={unmapped}
          chart={chart}
          canUpdate={canUpdate}
          onClose={() => setShowAiModal(false)}
        />
      )}
    </>
  );
}

function MappingSection({
  title,
  description,
  count,
  emptyMessage,
  children
}: {
  title: ReactNode;
  description: ReactNode;
  count: number;
  emptyMessage: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex w-full flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="text-[0.6875rem] font-semibold uppercase tracking-wider text-foreground/70">
            {title}
          </span>
          <span className="text-[0.6875rem] tabular-nums text-muted-foreground">
            {count}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="w-full rounded-lg border border-border">
        {count === 0 ? (
          <div className="flex w-full items-center justify-center py-8 text-sm text-muted-foreground">
            {emptyMessage}
          </div>
        ) : (
          <div className="flex w-full flex-col divide-y divide-border">
            {children}
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * One Carbon account → provider account row. Each row is its own
 * ValidatedForm posting intent=upsert-account-mapping; the provider
 * code/name of the selected option travel in hidden fields because the
 * journal syncer resolves account codes from the mapping metadata.
 */
function AccountMappingRowForm({
  accountId,
  accountNumber,
  accountName,
  currentExternalId,
  currentExternalCode,
  currentExternalName,
  chartById,
  chartOptions,
  canUpdate
}: {
  accountId: string;
  accountNumber: string | null;
  accountName: string | null;
  currentExternalId: string | null;
  currentExternalCode: string | null;
  currentExternalName: string | null;
  chartById: Map<string, AccountMappingChartAccount>;
  chartOptions: { value: string; label: string }[];
  canUpdate: boolean;
}) {
  const { t } = useLingui();
  const [selected, setSelected] = useState<{
    code: string | null;
    name: string | null;
  } | null>(
    currentExternalId
      ? { code: currentExternalCode, name: currentExternalName }
      : null
  );

  // A mapped provider account can be missing from the chart (archived or
  // the chart failed to load): keep it selectable/visible via a fallback
  // option built from the mapping metadata.
  const options = useMemo(() => {
    if (!currentExternalId || chartById.has(currentExternalId)) {
      return chartOptions;
    }
    const fallbackLabel = currentExternalCode
      ? `${currentExternalCode} - ${currentExternalName ?? currentExternalId}`
      : (currentExternalName ?? currentExternalId);
    return [
      { value: currentExternalId, label: fallbackLabel },
      ...chartOptions
    ];
  }, [
    chartById,
    chartOptions,
    currentExternalId,
    currentExternalCode,
    currentExternalName
  ]);

  return (
    <ValidatedForm
      validator={accountMappingUpsertValidator}
      method="post"
      defaultValues={{
        intent: "upsert-account-mapping",
        accountId,
        externalId: currentExternalId ?? undefined
      }}
      className="flex w-full items-center gap-3 p-3"
    >
      <input type="hidden" name="intent" value="upsert-account-mapping" />
      <input type="hidden" name="accountId" value={accountId} />
      <input type="hidden" name="externalCode" value={selected?.code ?? ""} />
      <input type="hidden" name="externalName" value={selected?.name ?? ""} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">
          {accountName ?? accountId}
        </span>
        {accountNumber && (
          <span className="font-mono text-xs text-muted-foreground">
            {accountNumber}
          </span>
        )}
      </div>
      <LuArrowRight className="size-4 shrink-0 text-muted-foreground" />
      <div className="w-[260px] shrink-0">
        <Combobox
          name="externalId"
          options={options}
          placeholder={t`Select provider account`}
          onChange={(option) => {
            if (!option) {
              setSelected(null);
              return;
            }
            const chartAccount = chartById.get(option.value);
            if (chartAccount) {
              setSelected({
                code: chartAccount.code,
                name: chartAccount.name
              });
            } else if (option.value === currentExternalId) {
              setSelected({
                code: currentExternalCode,
                name: currentExternalName
              });
            } else {
              setSelected(null);
            }
          }}
        />
      </div>
      <Submit size="sm" variant="secondary" isDisabled={!canUpdate}>
        <Trans>Save</Trans>
      </Submit>
    </ValidatedForm>
  );
}

/**
 * Preview of exact Carbon-number = provider-code matches with confirm-all.
 * Confirm submits one bulk POST with repeated JSON-encoded `mappings`
 * fields (per the sync-operation `ids` precedent).
 */
function MatchByCodeDrawer({
  proposals,
  canUpdate,
  onClose
}: {
  proposals: AccountMatchProposalRow[];
  canUpdate: boolean;
  onClose: () => void;
}) {
  const fetcher = useFetcher();
  const isSubmitting = fetcher.state !== "idle";
  const submittedRef = useRef(false);

  // Close once the confirm-all POST settles; revalidation has already
  // refreshed the sections behind the drawer.
  useEffect(() => {
    if (submittedRef.current && fetcher.state === "idle") {
      onClose();
    }
  }, [fetcher.state, onClose]);

  const confirmAll = () => {
    if (proposals.length === 0) return;
    const formData = new FormData();
    formData.append("intent", "bulk-upsert-account-mappings");
    for (const proposal of proposals) {
      formData.append(
        "mappings",
        JSON.stringify({
          accountId: proposal.accountId,
          externalId: proposal.externalId,
          externalCode: proposal.externalCode,
          ...(proposal.externalName
            ? { externalName: proposal.externalName }
            : {})
        })
      );
    }
    submittedRef.current = true;
    fetcher.submit(formData, { method: "post" });
  };

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent size="sm">
        <DrawerHeader>
          <DrawerTitle>
            <Trans>Match by code</Trans>
          </DrawerTitle>
          <DrawerDescription>
            <Trans>
              Proposed matches where the Carbon account number equals the
              provider account code exactly.
            </Trans>
          </DrawerDescription>
        </DrawerHeader>
        <DrawerBody>
          {proposals.length === 0 ? (
            <div className="flex w-full items-center justify-center py-16 text-sm text-muted-foreground">
              <Trans>No unmapped accounts match a provider code</Trans>
            </div>
          ) : (
            <div className="w-full rounded-lg border border-border">
              <Table>
                <Thead>
                  <Tr>
                    <Th className="px-4">
                      <Trans>Carbon account</Trans>
                    </Th>
                    <Th className="px-4">
                      <Trans>Provider account</Trans>
                    </Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {proposals.map((proposal) => (
                    <Tr key={proposal.accountId}>
                      <Td className="px-4">
                        <div className="flex flex-col py-1">
                          <span className="text-sm font-medium">
                            {proposal.accountName}
                          </span>
                          <span className="font-mono text-xs text-muted-foreground">
                            {proposal.accountNumber}
                          </span>
                        </div>
                      </Td>
                      <Td className="px-4">
                        <div className="flex flex-col py-1">
                          <span className="text-sm font-medium">
                            {proposal.externalName ?? proposal.externalCode}
                          </span>
                          <span className="font-mono text-xs text-muted-foreground">
                            {proposal.externalCode}
                          </span>
                        </div>
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </div>
          )}
        </DrawerBody>
        <DrawerFooter>
          <HStack>
            {proposals.length > 0 && (
              <Button
                leftIcon={<LuLink />}
                isDisabled={!canUpdate || isSubmitting}
                isLoading={isSubmitting}
                onClick={confirmAll}
              >
                <Trans>Confirm all</Trans>
              </Button>
            )}
            <Button variant="solid" onClick={onClose}>
              <Trans>Close</Trans>
            </Button>
          </HStack>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

/**
 * "Suggest with AI" confirmation modal. Confirming ships the unmapped
 * Carbon accounts + the provider chart to the `ai-suggest-account-mappings`
 * action (gpt-4o best-guess pairing), then previews the returned proposals
 * so the user can review before applying. Applying reuses the same
 * `bulk-upsert-account-mappings` confirm path as Match-by-code — the AI
 * step itself writes nothing.
 */
function AiSuggestModal({
  unmapped,
  chart,
  canUpdate,
  onClose
}: {
  unmapped: UnmappedAccountRow[];
  chart: AccountMappingChartAccount[];
  canUpdate: boolean;
  onClose: () => void;
}) {
  const suggestFetcher = useFetcher<{
    proposals?: AccountMatchProposalRow[];
  }>();
  const applyFetcher = useFetcher();
  const appliedRef = useRef(false);

  const isSuggesting = suggestFetcher.state !== "idle";
  const isApplying = applyFetcher.state !== "idle";
  const proposals = suggestFetcher.data?.proposals;
  const hasSuggested = proposals !== undefined;

  // Close once the apply POST settles; revalidation has already refreshed
  // the sections behind the modal.
  useEffect(() => {
    if (appliedRef.current && applyFetcher.state === "idle") {
      onClose();
    }
  }, [applyFetcher.state, onClose]);

  const suggest = () => {
    const formData = new FormData();
    formData.append("intent", "ai-suggest-account-mappings");
    formData.append("accounts", JSON.stringify(unmapped));
    formData.append("providerAccounts", JSON.stringify(chart));
    suggestFetcher.submit(formData, { method: "post" });
  };

  const applyAll = () => {
    if (!proposals || proposals.length === 0) return;
    const formData = new FormData();
    formData.append("intent", "bulk-upsert-account-mappings");
    for (const proposal of proposals) {
      formData.append(
        "mappings",
        JSON.stringify({
          accountId: proposal.accountId,
          externalId: proposal.externalId,
          ...(proposal.externalCode
            ? { externalCode: proposal.externalCode }
            : {}),
          ...(proposal.externalName
            ? { externalName: proposal.externalName }
            : {})
        })
      );
    }
    appliedRef.current = true;
    applyFetcher.submit(formData, { method: "post" });
  };

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent size="large">
        <ModalHeader>
          <ModalTitle>
            <Trans>Suggest mappings with AI</Trans>
          </ModalTitle>
          <ModalDescription>
            {hasSuggested ? (
              <Trans>
                Review the suggested matches before applying. These are a best
                guess — confirm each is correct.
              </Trans>
            ) : (
              <Trans>
                Carbon will use AI to guess a provider account for each of your{" "}
                {unmapped.length} unmapped accounts. Suggestions are a starting
                point — you can review them before anything is saved.
              </Trans>
            )}
          </ModalDescription>
        </ModalHeader>
        <ModalBody>
          {isSuggesting ? (
            <div className="flex w-full items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Spinner className="size-4" />
              <Trans>Generating suggestions…</Trans>
            </div>
          ) : !hasSuggested ? (
            <div className="flex w-full items-center justify-center py-8 text-sm text-muted-foreground">
              <Trans>
                {unmapped.length} unmapped accounts will be matched against{" "}
                {chart.length} provider accounts.
              </Trans>
            </div>
          ) : proposals.length === 0 ? (
            <div className="flex w-full items-center justify-center py-16 text-sm text-muted-foreground">
              <Trans>AI couldn't confidently match any accounts</Trans>
            </div>
          ) : (
            <div className="w-full rounded-lg border border-border">
              <Table>
                <Thead>
                  <Tr>
                    <Th className="px-4">
                      <Trans>Carbon account</Trans>
                    </Th>
                    <Th className="px-4">
                      <Trans>Provider account</Trans>
                    </Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {proposals.map((proposal) => (
                    <Tr key={proposal.accountId}>
                      <Td className="px-4">
                        <div className="flex flex-col py-1">
                          <span className="text-sm font-medium">
                            {proposal.accountName}
                          </span>
                          <span className="font-mono text-xs text-muted-foreground">
                            {proposal.accountNumber}
                          </span>
                        </div>
                      </Td>
                      <Td className="px-4">
                        <div className="flex flex-col py-1">
                          <span className="text-sm font-medium">
                            {proposal.externalName ?? proposal.externalCode}
                          </span>
                          <span className="font-mono text-xs text-muted-foreground">
                            {proposal.externalCode}
                          </span>
                        </div>
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          <HStack>
            {!hasSuggested ? (
              <Button
                leftIcon={<LuSparkles />}
                isDisabled={!canUpdate || isSuggesting}
                isLoading={isSuggesting}
                onClick={suggest}
              >
                <Trans>Suggest mappings</Trans>
              </Button>
            ) : (
              proposals.length > 0 && (
                <Button
                  leftIcon={<LuLink />}
                  isDisabled={!canUpdate || isApplying}
                  isLoading={isApplying}
                  onClick={applyAll}
                >
                  <Trans>Apply suggestions</Trans>
                </Button>
              )
            )}
            <Button variant="solid" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
          </HStack>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
