import {
  Hidden,
  NumberControlled,
  Select,
  TextArea,
  ValidatedForm
} from "@carbon/form";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Checkbox,
  cn,
  HStack,
  Label,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Select as StaticSelect,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useMemo, useRef, useState } from "react";
import { LuTriangleAlert } from "react-icons/lu";
import { useFetcher } from "react-router";
import ScrapReason from "~/components/JobOperation/components/ScrapReason";
import { inspectionDispositionValidator } from "~/services/models";
import type { IssueTypeListItem } from "~/services/types";
import { path } from "~/utils/path";

export type FailedFeatureSummary = {
  label: string;
  spec: string;
  failedValues: string[];
};

export type AllocatableUnit = {
  trackedEntityId: string;
  label: string;
  failed: boolean;
};

type UnitOutcome = "none" | "scrap" | "rework";

type UpstreamOperation = {
  id: string;
  processId: string;
  description: string | null;
  jobMakeMethod: {
    item: { name: string | null } | null;
  } | null;
};

type DispositionModalProps = {
  decision: "Reject" | "Partial";
  inspectionId: string;
  // Threads the jobOperationId through the action so it can post against the
  // operation and redirect back to this inspection view.
  operationId: string;
  isSerial: boolean;
  // Serial: the units the operator may allocate (failed first). Reject offers
  // the whole open remainder; Partial offers only the failed units.
  units: AllocatableUnit[];
  // Non-serial: the ceiling on scrap + rework (failed count for Partial, the
  // operation's remaining quantity for Reject).
  maxAllocatable: number;
  // Partial: how many passed units the disposition will complete (display).
  completions: number;
  issueTypes: IssueTypeListItem[];
  summary: string;
  failedFeatureSummary?: FailedFeatureSummary[];
  eventIds: {
    setupProductionEventId?: string;
    laborProductionEventId?: string;
    machineProductionEventId?: string;
  };
  onCancel: () => void;
  onSubmit: () => void;
};

// The failed-set allocator: whenever a lot is rejected (or partially
// accepted), the operator routes the failed units to Scrap (reason) or Rework
// (an upstream operation — the routing clone re-inspects automatically), or
// records the verdict only. One decision surface; the server recomputes and
// clamps every bucket.
const DispositionModal = ({
  decision,
  inspectionId,
  operationId,
  isSerial,
  units,
  maxAllocatable,
  completions,
  issueTypes,
  summary,
  failedFeatureSummary,
  eventIds,
  onCancel,
  onSubmit
}: DispositionModalProps) => {
  const { t } = useLingui();
  const fetcher = useFetcher<{}>();
  const targetsFetcher = useFetcher<{ operations: UpstreamOperation[] }>();
  const submitted = useRef(false);
  const loadedTargetsRef = useRef(false);

  // Scrapping the failed units is the common outcome — default to it so the
  // usual flow is one tap; "record only" is a bulk shortcut away.
  const [unitOutcomes, setUnitOutcomes] = useState<Map<string, UnitOutcome>>(
    () =>
      new Map(
        units.map((unit) => [
          unit.trackedEntityId,
          unit.failed ? "scrap" : "none"
        ])
      )
  );
  const [scrapQuantity, setScrapQuantity] = useState(
    isSerial ? 0 : maxAllocatable
  );
  const [reworkQuantity, setReworkQuantity] = useState(0);
  const [createNcr, setCreateNcr] = useState(decision === "Reject");
  const [issueTypeId, setIssueTypeId] = useState<string>(
    issueTypes[0]?.id ?? ""
  );

  useEffect(() => {
    if (loadedTargetsRef.current) return;
    loadedTargetsRef.current = true;
    targetsFetcher.load(path.to.reworkTargets(operationId));
  }, [operationId, targetsFetcher.load]);

  useEffect(() => {
    if (fetcher.state === "idle" && submitted.current) {
      onSubmit();
      submitted.current = false;
    }
  }, [fetcher.state, onSubmit]);

  const targets = targetsFetcher.data?.operations ?? [];
  const hasIssueTypes = issueTypes.length > 0;

  const scrapEntityIds = useMemo(
    () =>
      units
        .map((unit) => unit.trackedEntityId)
        .filter((id) => unitOutcomes.get(id) === "scrap"),
    [units, unitOutcomes]
  );
  const reworkEntityIds = useMemo(
    () =>
      units
        .map((unit) => unit.trackedEntityId)
        .filter((id) => unitOutcomes.get(id) === "rework"),
    [units, unitOutcomes]
  );

  const scrapCount = isSerial ? scrapEntityIds.length : scrapQuantity;
  const reworkCount = isSerial ? reworkEntityIds.length : reworkQuantity;
  const overAllocated = !isSerial && scrapCount + reworkCount > maxAllocatable;

  const setAll = (outcome: UnitOutcome) => {
    setUnitOutcomes(
      new Map(units.map((unit) => [unit.trackedEntityId, outcome]))
    );
  };

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <ModalOverlay />
      <ModalContent>
        <ValidatedForm
          method="post"
          action={path.to.inspectionDisposition(inspectionId)}
          validator={inspectionDispositionValidator}
          defaultValues={{
            decision,
            operationId
          }}
          fetcher={fetcher}
          onSubmit={() => {
            submitted.current = true;
          }}
        >
          <ModalHeader>
            <ModalTitle>
              {decision === "Reject" ? (
                <Trans>Reject Lot</Trans>
              ) : (
                <Trans>Partial Disposition</Trans>
              )}
            </ModalTitle>
          </ModalHeader>
          <ModalBody>
            <Hidden name="decision" value={decision} />
            <Hidden name="operationId" value={operationId} />
            {isSerial ? (
              <>
                <Hidden
                  name="scrapEntityIds"
                  value={JSON.stringify(scrapEntityIds)}
                />
                <Hidden
                  name="reworkEntityIds"
                  value={JSON.stringify(reworkEntityIds)}
                />
              </>
            ) : null}
            {eventIds.setupProductionEventId ? (
              <Hidden
                name="setupProductionEventId"
                value={eventIds.setupProductionEventId}
              />
            ) : null}
            {eventIds.laborProductionEventId ? (
              <Hidden
                name="laborProductionEventId"
                value={eventIds.laborProductionEventId}
              />
            ) : null}
            {eventIds.machineProductionEventId ? (
              <Hidden
                name="machineProductionEventId"
                value={eventIds.machineProductionEventId}
              />
            ) : null}
            <input
              type="hidden"
              name="createNcr"
              value={createNcr ? "true" : "false"}
            />
            <input
              type="hidden"
              name="nonConformanceTypeId"
              value={createNcr ? issueTypeId : ""}
            />

            <VStack spacing={4}>
              <p className="text-sm text-muted-foreground">{summary}</p>
              {decision === "Partial" && completions > 0 ? (
                <p className="text-sm text-emerald-600 dark:text-emerald-400">
                  <Trans>{completions} passed unit(s) will be completed.</Trans>
                </p>
              ) : null}
              {failedFeatureSummary && failedFeatureSummary.length > 0 && (
                <div className="w-full rounded-md border p-3">
                  <p className="mb-1 text-xs font-medium text-muted-foreground">
                    <Trans>Failed features</Trans>
                  </p>
                  <ul className="flex flex-col gap-0.5">
                    {failedFeatureSummary.map((feature) => (
                      <li
                        key={feature.label}
                        className="font-mono text-xs text-red-500"
                      >
                        {feature.label}
                        {feature.spec ? ` (${feature.spec})` : ""}
                        {feature.failedValues.length > 0
                          ? `: ${feature.failedValues.join(", ")}`
                          : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {isSerial ? (
                <div className="flex w-full flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <Label>
                      {decision === "Reject" ? (
                        <Trans>Allocate units</Trans>
                      ) : (
                        <Trans>Allocate failed units</Trans>
                      )}
                    </Label>
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setAll("scrap")}
                      >
                        <Trans>All scrap</Trans>
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setAll("rework")}
                      >
                        <Trans>All rework</Trans>
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setAll("none")}
                      >
                        <Trans>Record only</Trans>
                      </Button>
                    </div>
                  </div>
                  <div className="max-h-48 w-full overflow-y-auto rounded-lg border">
                    {units.length === 0 ? (
                      <div className="py-6 text-center text-sm text-muted-foreground">
                        <Trans>No open units to allocate</Trans>
                      </div>
                    ) : (
                      units.map((unit) => {
                        const outcome =
                          unitOutcomes.get(unit.trackedEntityId) ?? "none";
                        return (
                          <div
                            key={unit.trackedEntityId}
                            className="flex items-center justify-between gap-3 border-b px-3 py-2 last:border-b-0"
                          >
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="truncate font-mono text-sm">
                                {unit.label}
                              </span>
                              {unit.failed ? (
                                <span className="shrink-0 text-xs font-medium text-red-500">
                                  <Trans>Failed</Trans>
                                </span>
                              ) : null}
                            </div>
                            <div className="flex shrink-0 overflow-hidden rounded-md border">
                              {(
                                [
                                  ["none", t`Record`],
                                  ["scrap", t`Scrap`],
                                  ["rework", t`Rework`]
                                ] as const
                              ).map(([value, label]) => (
                                <button
                                  key={value}
                                  type="button"
                                  onClick={() =>
                                    setUnitOutcomes((prev) => {
                                      const next = new Map(prev);
                                      next.set(unit.trackedEntityId, value);
                                      return next;
                                    })
                                  }
                                  className={cn(
                                    "px-2 py-1 text-xs font-medium transition-colors",
                                    outcome === value
                                      ? value === "scrap"
                                        ? "bg-red-500 text-white"
                                        : value === "rework"
                                          ? "bg-blue-500 text-white"
                                          : "bg-accent text-accent-foreground"
                                      : "hover:bg-muted"
                                  )}
                                >
                                  {label}
                                </button>
                              ))}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              ) : (
                <div className="grid w-full grid-cols-2 gap-4">
                  <NumberControlled
                    name="scrapQuantity"
                    label={t`Scrap quantity`}
                    value={scrapQuantity}
                    onChange={setScrapQuantity}
                    minValue={0}
                    maxValue={maxAllocatable}
                  />
                  <NumberControlled
                    name="reworkQuantity"
                    label={t`Rework quantity`}
                    value={reworkQuantity}
                    onChange={setReworkQuantity}
                    minValue={0}
                    maxValue={maxAllocatable}
                  />
                </div>
              )}
              {!isSerial ? (
                <p
                  className={cn(
                    "text-xs",
                    overAllocated
                      ? "font-medium text-red-500"
                      : "text-muted-foreground"
                  )}
                >
                  <Trans>
                    Up to {maxAllocatable} unit(s) can be allocated; the rest is
                    recorded without a posting.
                  </Trans>
                </p>
              ) : null}

              {scrapCount > 0 ? (
                <ScrapReason name="scrapReasonId" label={t`Scrap Reason`} />
              ) : null}

              {reworkCount > 0 ? (
                <>
                  <Select
                    name="targetOperationId"
                    label={t`Go back to operation`}
                    options={targets.map((op) => ({
                      value: op.id,
                      label: op.description || op.processId
                    }))}
                  />
                  <TextArea
                    name="reworkReason"
                    label={t`Reason for rework`}
                    placeholder={t`Describe what needs to be reworked...`}
                  />
                </>
              ) : null}

              <label className="flex w-full cursor-pointer items-center gap-2">
                <Checkbox
                  isChecked={createNcr}
                  onCheckedChange={(checked) => setCreateNcr(!!checked)}
                />
                <span className="text-sm font-medium">
                  <Trans>Open an NCR for MRB disposition</Trans>
                </span>
              </label>
              {createNcr &&
                (hasIssueTypes ? (
                  <div className="flex w-full flex-col gap-2">
                    <Label htmlFor="nonConformanceTypeId">
                      <Trans>Issue Type</Trans>
                    </Label>
                    <StaticSelect
                      value={issueTypeId}
                      onValueChange={setIssueTypeId}
                    >
                      <SelectTrigger id="nonConformanceTypeId">
                        <SelectValue placeholder={t`Select an issue type`} />
                      </SelectTrigger>
                      <SelectContent>
                        {issueTypes.map((type) => (
                          <SelectItem key={type.id} value={type.id}>
                            {type.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </StaticSelect>
                  </div>
                ) : (
                  <Alert variant="warning">
                    <LuTriangleAlert className="size-4" />
                    <AlertTitle>
                      <Trans>No issue types configured</Trans>
                    </AlertTitle>
                    <AlertDescription>
                      <Trans>
                        The lot will still be dispositioned, but an NCR cannot
                        be created until at least one Issue Type is configured.
                      </Trans>
                    </AlertDescription>
                  </Alert>
                ))}
            </VStack>
          </ModalBody>
          <ModalFooter>
            <HStack>
              <Button variant="secondary" onClick={onCancel}>
                <Trans>Cancel</Trans>
              </Button>
              <Button
                variant={decision === "Reject" ? "destructive" : "primary"}
                type="submit"
                isLoading={fetcher.state !== "idle"}
                isDisabled={
                  fetcher.state !== "idle" ||
                  overAllocated ||
                  (createNcr && hasIssueTypes && !issueTypeId)
                }
              >
                {decision === "Reject" ? (
                  <Trans>Reject Lot</Trans>
                ) : (
                  <Trans>Record Partial</Trans>
                )}
              </Button>
            </HStack>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
};

export default DispositionModal;
