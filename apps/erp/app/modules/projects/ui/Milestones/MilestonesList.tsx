// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  BarProgress,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  useDisclosure
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import {
  LuCircleCheck,
  LuEllipsis,
  LuFlag,
  LuPencil,
  LuPlus,
  LuRotateCcw,
  LuTrash
} from "react-icons/lu";
import { Link, useFetcher } from "react-router";
import Confirm from "~/components/Modals/Confirm/Confirm";
import {
  useCurrencyFormatter,
  useDateFormatter,
  usePermissions,
  useQuantityFormatter
} from "~/hooks";
import { path } from "~/utils/path";
import type { MilestoneGroup, MilestoneSummary } from "../../projects.models";
import type { ProjectMilestone } from "../../types";
import MilestoneForm from "./MilestoneForm";

type Milestone = MilestoneSummary<ProjectMilestone>;

type MilestonesListProps = {
  projectId: string;
  milestones: Milestone[];
  action: string;
  isDisabled: boolean;
};

type EditingMilestone = {
  id?: string;
  name: string;
  startDate?: string;
  endDate?: string;
};

const GROUP_ORDER: MilestoneGroup[] = ["Active", "Upcoming", "Completed"];

const MilestonesList = ({
  projectId,
  milestones,
  action,
  isDisabled
}: MilestonesListProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const canUpdate = permissions.can("update", "projects") && !isDisabled;
  const [editing, setEditing] = useState<EditingMilestone | null>(null);
  const [deleting, setDeleting] = useState<Milestone | null>(null);
  const deleteDisclosure = useDisclosure();

  const groupLabels: Record<MilestoneGroup, string> = {
    Active: t`Active`,
    Upcoming: t`Upcoming`,
    Completed: t`Completed`
  };

  return (
    <div className="flex flex-col gap-4 p-4 max-w-[80rem] mx-auto w-full">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-medium">
          <Trans>Milestones</Trans>
        </h2>
        <Button
          variant="secondary"
          leftIcon={<LuPlus />}
          isDisabled={!canUpdate}
          onClick={() => setEditing({ name: "" })}
        >
          <Trans>New Milestone</Trans>
        </Button>
      </div>

      {milestones.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-4 py-10 text-center">
          <LuFlag className="size-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            <Trans>
              No milestones yet. Add one, then set it on the elements it covers.
            </Trans>
          </p>
          <Button
            leftIcon={<LuPlus />}
            isDisabled={!canUpdate}
            onClick={() => setEditing({ name: "" })}
          >
            <Trans>Add the first milestone</Trans>
          </Button>
        </div>
      ) : (
        GROUP_ORDER.map((group) => {
          const rows = milestones.filter((m) => m.group === group);
          if (rows.length === 0) return null;
          return (
            <section key={group} className="flex flex-col gap-1">
              <h3 className="px-1 text-xs font-medium text-muted-foreground">
                {groupLabels[group]}
                <span className="ml-1.5 tabular-nums">{rows.length}</span>
              </h3>
              <div className="flex flex-col rounded-lg border border-border bg-card">
                {rows.map((milestone) => (
                  <MilestoneRow
                    key={milestone.id}
                    projectId={projectId}
                    milestone={milestone}
                    action={action}
                    canUpdate={canUpdate}
                    onEdit={() =>
                      setEditing({
                        id: milestone.id,
                        name: milestone.name,
                        startDate: milestone.startDate ?? undefined,
                        endDate: milestone.endDate ?? undefined
                      })
                    }
                    onDelete={() => {
                      setDeleting(milestone);
                      deleteDisclosure.onOpen();
                    }}
                  />
                ))}
              </div>
            </section>
          );
        })
      )}

      {editing && (
        <MilestoneForm
          action={action}
          initialValues={editing}
          onClose={() => setEditing(null)}
        />
      )}

      {deleteDisclosure.isOpen && deleting && (
        <Confirm
          action={action}
          title={t`Delete ${deleting.name}`}
          text={t`Delete the milestone ${deleting.name}? Its elements stay, without a milestone.`}
          confirmText={t`Delete`}
          confirmVariant="destructive"
          onCancel={() => {
            deleteDisclosure.onClose();
            setDeleting(null);
          }}
          onSubmit={() => {
            deleteDisclosure.onClose();
            setDeleting(null);
          }}
        >
          <input type="hidden" name="intent" value="delete" />
          <input type="hidden" name="id" value={deleting.id} />
        </Confirm>
      )}
    </div>
  );
};

function MilestoneRow({
  projectId,
  milestone,
  action,
  canUpdate,
  onEdit,
  onDelete
}: {
  projectId: string;
  milestone: Milestone;
  action: string;
  canUpdate: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useLingui();
  const fetcher = useFetcher();
  const formatMoney = useCurrencyFormatter();
  const formatQuantity = useQuantityFormatter();
  const { formatDate } = useDateFormatter();

  const isCompleted = milestone.group === "Completed";
  const to = `${path.to.projectElements(projectId)}?filter=${encodeURIComponent(
    `milestoneId:eq:${milestone.id}`
  )}`;
  const dateRange =
    milestone.startDate && milestone.endDate
      ? `${formatDate(milestone.startDate)} – ${formatDate(milestone.endDate)}`
      : milestone.endDate
        ? t`Due ${formatDate(milestone.endDate)}`
        : milestone.startDate
          ? t`From ${formatDate(milestone.startDate)}`
          : t`No dates`;

  const setCompleted = (completed: boolean) =>
    fetcher.submit(
      { intent: completed ? "complete" : "reopen", id: milestone.id },
      { method: "post", action }
    );

  return (
    <div className="@container relative border-b border-border last:border-b-0 hover:bg-accent/50">
      <Link
        to={to}
        className="flex flex-col gap-2 px-3 py-2.5 pr-12 @min-[42rem]:flex-row @min-[42rem]:items-center @min-[42rem]:gap-4"
      >
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{milestone.name}</span>
          <span
            className={
              milestone.isOverdue
                ? "truncate text-xs text-red-500"
                : "truncate text-xs text-muted-foreground"
            }
          >
            {dateRange}
          </span>
        </div>
        <div className="w-full shrink-0 @min-[42rem]:w-40">
          <BarProgress
            progress={milestone.completedCount}
            max={Math.max(milestone.elementCount, 1)}
            label={t`Elements`}
            value={`${milestone.completedCount} / ${milestone.elementCount}`}
          />
        </div>
        <div className="flex shrink-0 gap-4 text-xs tabular-nums @min-[42rem]:contents">
          <div className="flex flex-col @min-[42rem]:w-28 @min-[42rem]:items-end">
            <span className="text-muted-foreground">
              <Trans>Hours</Trans>
            </span>
            <span className="whitespace-nowrap">
              {formatQuantity(milestone.actualHours)} /{" "}
              {formatQuantity(milestone.estimatedHours)}
            </span>
          </div>
          <div className="flex flex-col @min-[42rem]:w-40 @min-[42rem]:items-end">
            <span className="text-muted-foreground">
              <Trans>Cost</Trans>
            </span>
            <span
              className={
                milestone.budget > 0 && milestone.actualCost > milestone.budget
                  ? "whitespace-nowrap text-red-500"
                  : "whitespace-nowrap"
              }
            >
              {formatMoney.format(milestone.actualCost)} /{" "}
              {milestone.budget > 0
                ? formatMoney.format(milestone.budget)
                : "—"}
            </span>
          </div>
        </div>
      </Link>
      <div className="absolute right-2 top-2.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              aria-label={t`More options`}
              icon={<LuEllipsis />}
              variant="ghost"
              size="sm"
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem disabled={!canUpdate} onClick={onEdit}>
              <DropdownMenuIcon icon={<LuPencil />} />
              <Trans>Edit</Trans>
            </DropdownMenuItem>
            {isCompleted ? (
              <DropdownMenuItem
                disabled={!canUpdate}
                onClick={() => setCompleted(false)}
              >
                <DropdownMenuIcon icon={<LuRotateCcw />} />
                <Trans>Reopen</Trans>
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                disabled={!canUpdate}
                onClick={() => setCompleted(true)}
              >
                <DropdownMenuIcon icon={<LuCircleCheck />} />
                <Trans>Complete</Trans>
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              destructive
              disabled={!canUpdate}
              onClick={onDelete}
            >
              <DropdownMenuIcon icon={<LuTrash />} />
              <Trans>Delete</Trans>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

export default MilestonesList;
