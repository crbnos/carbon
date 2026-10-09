// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Button, Copy, cn, Subheading, Switch } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useState } from "react";
import { LuBuilding2 } from "react-icons/lu";
import { Link } from "react-router";
import { usePermissions } from "~/hooks";
import FixedAssetStatus from "~/modules/accounting/ui/FixedAssets/FixedAssetStatus";
import { path } from "~/utils/path";
import type { ProjectCostTreatment } from "../../projects.models";
import type { ProjectElementPage } from "../../projects.server";
import type { ProjectLabel, ProjectMilestone, ProjectState } from "../../types";
import {
  DatePill,
  LabelsPill,
  MilestonePill,
  NumberPill,
  OwnerPill,
  PriorityPill,
  StatePill,
  useElementField
} from "../Elements/ElementProperties";
import {
  ElementTypeIcon,
  useElementTypeLabels
} from "../Elements/ElementTypeIcon";
import { PartLink } from "./PartLink";
import { PlaceInServiceModal } from "./PlaceInServiceModal";

type Element = ProjectElementPage["element"];
type CapitalAsset = ProjectElementPage["capitalAsset"];

/** One property row: a 120 px label column and the value's ghost editor. */
function Property({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-8 items-center gap-2">
      <span className="w-[120px] shrink-0 text-xs text-muted-foreground">
        {label}
      </span>
      <div className="flex min-w-0 flex-1 items-center">{children}</div>
    </div>
  );
}

export function ElementSidebar({
  projectId,
  element,
  capitalAsset,
  costTreatment,
  states,
  labels,
  milestones,
  isDisabled,
  className
}: {
  projectId: string;
  element: Element;
  capitalAsset: CapitalAsset;
  costTreatment: ProjectCostTreatment | null;
  states: ProjectState[];
  labels: ProjectLabel[];
  milestones: ProjectMilestone[];
  isDisabled: boolean;
  className?: string;
}) {
  const { t } = useLingui();
  const typeLabels = useElementTypeLabels();
  const common = {
    projectId,
    elementId: element.id,
    isDisabled,
    variant: "ghost" as const
  };

  return (
    <div className={cn("flex flex-col gap-1 text-sm", className)}>
      <Subheading as="h3" variant="light" className="mb-2">
        <Trans>Properties</Trans>
      </Subheading>
      <Property label={t`Type`}>
        <span className="inline-flex h-8 items-center gap-2 px-2">
          <ElementTypeIcon type={element.type} />
          {typeLabels[element.type]}
        </span>
      </Property>
      <Property label={t`State`}>
        <StatePill {...common} stateId={element.stateId} states={states} />
      </Property>
      <Property label={t`Owner`}>
        <OwnerPill {...common} ownerId={element.ownerId} />
      </Property>
      <Property label={t`Priority`}>
        <PriorityPill {...common} priority={element.priority} />
      </Property>
      <Property label={t`Labels`}>
        <LabelsPill
          {...common}
          labelIds={(element.labels ?? []).map((l) => l.projectLabelId)}
          labels={labels}
        />
      </Property>
      <Property label={t`Start date`}>
        <DatePill {...common} field="startDate" date={element.startDate} />
      </Property>
      <Property label={t`Target date`}>
        <DatePill
          {...common}
          field="targetDate"
          date={element.targetDate}
          isComplete={!!element.completedAt}
        />
      </Property>
      <Property label={t`Milestone`}>
        <MilestonePill
          {...common}
          milestoneId={element.milestoneId}
          milestones={milestones}
        />
      </Property>
      <Property label={t`Charge number`}>
        <span className="inline-flex h-8 items-center gap-1 px-2">
          <span className="whitespace-nowrap font-mono text-sm">
            {element.readableId}
          </span>
          <Copy
            text={element.readableId}
            label={t`Copy charge number`}
            variant="ghost"
          />
        </span>
      </Property>
      <Property label={t`Chargeable`}>
        <ChargeableSwitch
          projectId={projectId}
          elementId={element.id}
          isChargeable={element.isChargeable}
          isDisabled={isDisabled || element.type === "Parameter"}
        />
      </Property>
      <Property label={t`Budget`}>
        <NumberPill {...common} field="budget" number={element.budget} />
      </Property>
      <Property label={t`Hours estimate`}>
        <NumberPill
          {...common}
          field="estimatedHours"
          number={element.estimatedHours}
        />
      </Property>
      {costTreatment === "Capitalize" && element.type !== "Parameter" && (
        <>
          <Property label={t`Final asset`}>
            <FinalAssetSwitch
              projectId={projectId}
              elementId={element.id}
              isFinalAsset={element.isFinalAsset}
              isDisabled={isDisabled}
            />
          </Property>
          {element.isFinalAsset && (
            <Property label={t`Asset`}>
              <CapitalAssetLink projectId={projectId} asset={capitalAsset} />
            </Property>
          )}
        </>
      )}
      {element.type !== "Parameter" && (
        <Property label={t`Linked part`}>
          <PartLink
            projectId={projectId}
            element={element}
            isDisabled={isDisabled}
          />
        </Property>
      )}
    </div>
  );
}

function ChargeableSwitch({
  projectId,
  elementId,
  isChargeable,
  isDisabled
}: {
  projectId: string;
  elementId: string;
  isChargeable: boolean;
  isDisabled: boolean;
}) {
  const { t } = useLingui();
  const { pending, submit } = useElementField(
    projectId,
    elementId,
    "isChargeable"
  );
  const checked = pending === undefined ? isChargeable : pending === "true";
  return (
    <div className="px-2">
      <Switch
        variant="small"
        aria-label={t`Chargeable`}
        checked={checked}
        disabled={isDisabled}
        onCheckedChange={(next) => submit(next ? "true" : "false")}
      />
    </div>
  );
}

function FinalAssetSwitch({
  projectId,
  elementId,
  isFinalAsset,
  isDisabled
}: {
  projectId: string;
  elementId: string;
  isFinalAsset: boolean;
  isDisabled: boolean;
}) {
  const { t } = useLingui();
  const { pending, submit } = useElementField(
    projectId,
    elementId,
    "isFinalAsset"
  );
  const checked = pending === undefined ? isFinalAsset : pending === "true";
  return (
    <div className="px-2">
      <Switch
        variant="small"
        aria-label={t`Final asset`}
        checked={checked}
        disabled={isDisabled}
        onCheckedChange={(next) => submit(next ? "true" : "false")}
      />
    </div>
  );
}

/** The final asset's asset, its status, and Place in service. */
function CapitalAssetLink({
  projectId,
  asset
}: {
  projectId: string;
  asset: CapitalAsset;
}) {
  const permissions = usePermissions();
  const [placing, setPlacing] = useState(false);
  if (!asset) {
    return (
      <span className="px-2 text-sm text-muted-foreground">
        <Trans>Created when the project is released</Trans>
      </span>
    );
  }
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 px-2">
      <Link
        to={path.to.fixedAsset(asset.id)}
        className="font-mono text-sm hover:underline"
      >
        {asset.fixedAssetId}
      </Link>
      <FixedAssetStatus status={asset.status} />
      {asset.status === "Under Construction" && (
        <Button
          variant="secondary"
          size="sm"
          leftIcon={<LuBuilding2 />}
          isDisabled={
            !permissions.can("create", "accounting") ||
            !permissions.can("update", "projects")
          }
          onClick={() => setPlacing(true)}
        >
          <Trans>Place in service</Trans>
        </Button>
      )}
      {placing && (
        <PlaceInServiceModal
          projectId={projectId}
          fixedAssetId={asset.id}
          onClose={() => setPlacing(false)}
        />
      )}
    </div>
  );
}
