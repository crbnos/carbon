// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import { useAction } from "@carbon/query";
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  ModalDrawer,
  ModalDrawerBody,
  ModalDrawerContent,
  ModalDrawerFooter,
  ModalDrawerHeader,
  ModalDrawerProvider,
  ModalDrawerTitle
} from "@carbon/react";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import {
  LuEllipsis,
  LuGitCompareArrows,
  LuHistory,
  LuPlus
} from "react-icons/lu";
import { Link, useNavigate } from "react-router";
import EmployeeAvatar from "~/components/EmployeeAvatar";
import { Hidden, Input, Submit } from "~/components/Form";
import { useDateFormatter, usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import type { ProjectBaselineSource } from "../../projects.models";
import { projectBaselineValidator } from "../../projects.models";
import type { ProjectBaselineListItem } from "../../types";

type BaselinesListProps = {
  projectId: string;
  baselines: ProjectBaselineListItem[];
  action: string;
};

/** The baselines of a project, newest first, with Take Baseline and compare. */
const BaselinesList = ({
  projectId,
  baselines,
  action
}: BaselinesListProps) => {
  const permissions = usePermissions();
  const canUpdate = permissions.can("update", "projects");
  const [isTaking, setIsTaking] = useState(false);

  return (
    <div className="mx-auto flex w-full max-w-[80rem] flex-col gap-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-medium">
          <Trans>Baselines</Trans>
        </h2>
        <Button
          variant="secondary"
          leftIcon={<LuPlus />}
          isDisabled={!canUpdate}
          onClick={() => setIsTaking(true)}
        >
          <Trans>Take Baseline</Trans>
        </Button>
      </div>

      {baselines.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-4 py-10 text-center">
          <LuHistory className="size-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            <Trans>
              No baselines yet. Take one to keep a copy of the plan, then
              compare it with the plan later.
            </Trans>
          </p>
          <Button
            leftIcon={<LuPlus />}
            isDisabled={!canUpdate}
            onClick={() => setIsTaking(true)}
          >
            <Trans>Take the first baseline</Trans>
          </Button>
        </div>
      ) : (
        <div className="flex flex-col rounded-lg border border-border bg-card">
          {baselines.map((baseline) => (
            <BaselineRow
              key={baseline.id}
              projectId={projectId}
              baseline={baseline}
              others={baselines.filter((b) => b.id !== baseline.id)}
            />
          ))}
        </div>
      )}

      {isTaking && (
        <TakeBaselineForm action={action} onClose={() => setIsTaking(false)} />
      )}
    </div>
  );
};

export function useBaselineSourceLabel() {
  const { t } = useLingui();
  const labels: Record<ProjectBaselineSource, string> = {
    Manual: t`Manual`,
    Milestone: t`Milestone`,
    "Change Request": t`Change request`
  };
  return (source: ProjectBaselineSource) => labels[source];
}

function BaselineRow({
  projectId,
  baseline,
  others
}: {
  projectId: string;
  baseline: ProjectBaselineListItem;
  others: ProjectBaselineListItem[];
}) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const { formatDateTime } = useDateFormatter();
  const sourceLabel = useBaselineSourceLabel();
  const compareWithCurrent = path.to.projectBaselineCompare(
    projectId,
    baseline.id
  );

  return (
    <div className="@container relative border-b border-border last:border-b-0 hover:bg-accent/50">
      <Link
        to={compareWithCurrent}
        className="flex flex-col gap-1 px-3 py-2.5 pr-12 @min-[42rem]:flex-row @min-[42rem]:items-center @min-[42rem]:gap-4"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            #{baseline.sequence}
          </span>
          <span className="truncate text-sm font-medium">{baseline.name}</span>
          <Badge variant="outline" className="shrink-0">
            {sourceLabel(baseline.source)}
          </Badge>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground tabular-nums">
          <span className="whitespace-nowrap">
            <Plural
              value={baseline.elementCount}
              one="# element"
              other="# elements"
            />
          </span>
          <span className="whitespace-nowrap">
            <Plural value={baseline.linkCount} one="# link" other="# links" />
          </span>
          <span className="flex items-center gap-1.5 whitespace-nowrap">
            <EmployeeAvatar employeeId={baseline.createdBy} size="xxs" />
            {formatDateTime(baseline.createdAt)}
          </span>
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
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onClick={() => navigate(compareWithCurrent)}>
              <DropdownMenuIcon icon={<LuGitCompareArrows />} />
              <Trans>Compare with current</Trans>
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger disabled={others.length === 0}>
                <DropdownMenuIcon icon={<LuHistory />} />
                <Trans>Compare with…</Trans>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-w-72">
                {others.map((other) => (
                  <DropdownMenuItem
                    key={other.id}
                    onClick={() =>
                      navigate(
                        // The older baseline is the base of the compare.
                        other.sequence < baseline.sequence
                          ? path.to.projectBaselineCompare(
                              projectId,
                              other.id,
                              baseline.id
                            )
                          : path.to.projectBaselineCompare(
                              projectId,
                              baseline.id,
                              other.id
                            )
                      )
                    }
                  >
                    <span className="truncate">
                      #{other.sequence} {other.name}
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

/** Names and takes a baseline. It stays open on a refusal. */
function TakeBaselineForm({
  action,
  onClose
}: {
  action: string;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const fetcher = useAction({ onSuccess: onClose });

  return (
    <ModalDrawerProvider type="modal">
      <ModalDrawer
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <ModalDrawerContent>
          <ValidatedForm
            validator={projectBaselineValidator}
            method="post"
            action={action}
            defaultValues={{ name: "" }}
            fetcher={fetcher}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                <Trans>Take Baseline</Trans>
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="intent" value="create" />
              <Input
                name="name"
                label={t`Name`}
                placeholder={t`Design review`}
                autoFocus
              />
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit>
                  <Trans>Take Baseline</Trans>
                </Submit>
                <Button size="md" variant="solid" onClick={onClose}>
                  <Trans>Cancel</Trans>
                </Button>
              </HStack>
            </ModalDrawerFooter>
          </ValidatedForm>
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
}

export default BaselinesList;
