// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Badge,
  cn,
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo, useRef } from "react";
import { LuChevronDown, LuChevronRight } from "react-icons/lu";
import { useNavigate, useParams } from "react-router";
import { Empty } from "~/components";
import { LevelLine, TreeView, useTree } from "~/components/TreeView";
import { useCurrencyFormatter } from "~/hooks";
import { path } from "~/utils/path";
import type {
  ProjectCostFigures,
  ProjectElementType
} from "../../projects.models";
import { buildElementTree } from "../../projects.models";
import { ElementTypeIcon } from "../Elements/ElementTypeIcon";
import type { ProjectBurdenPoolRow } from "./ProjectBurdenByPool.ee";
import ProjectBurdenByPool from "./ProjectBurdenByPool.ee";
import type { ServiceOrderCostRow } from "./ServiceOrderCosts";
import ServiceOrderCosts from "./ServiceOrderCosts";

export type ProjectCostRow = {
  id: string;
  parentId: string | null;
  sortOrder: number;
  readableId: string;
  name: string;
  type: ProjectElementType;
  isPreproduction: boolean;
  figures: ProjectCostFigures;
};

type ProjectCostsTreeProps = {
  projectId: string;
  rows: ProjectCostRow[];
  /** The project total; its actual includes `serviceActual`. */
  project: ProjectCostFigures;
  serviceOrders: ServiceOrderCostRow[];
  serviceActual: number;
  /** The actual cost of the preproduction elements, or null with none. */
  preproduction: number | null;
  /** Allowable burden per element, each row its subtree (Phase 5b). */
  burdenByElement: Record<string, number>;
  /** Allowable burden of the whole project. */
  projectBurden: number;
  /** The project's burden per indirect pool; empty with no burden. */
  burdenByPool: ProjectBurdenPoolRow[];
};

const ROW_HEIGHT = 36;
const FIGURE_CELL = "w-28 shrink-0 px-2 text-right tabular-nums";

/**
 * The element tree with plan, budget, committed, allowable and unallowable
 * actual, remaining and estimate at completion. Each row is its subtree. A
 * row opens its ledger.
 */
export default function ProjectCostsTree({
  projectId,
  rows,
  project,
  serviceOrders,
  serviceActual,
  preproduction,
  burdenByElement,
  projectBurden,
  burdenByPool
}: ProjectCostsTreeProps) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const { elementId: openElementId } = useParams();
  const parentRef = useRef<HTMLDivElement>(null);
  const formatMoney = useCurrencyFormatter();
  const tree = useMemo(() => buildElementTree(rows), [rows]);

  const { nodes, getTreeProps, getNodeProps, toggleExpandNode, virtualizer } =
    useTree<ProjectCostRow, undefined>({
      tree,
      parentRef,
      estimatedRowHeight: () => ROW_HEIGHT,
      isEager: true
    });

  const money = (value: number | null) =>
    value === null ? "—" : formatMoney.format(value);
  const serviceAmount = money(serviceActual);
  const preproductionAmount = money(preproduction);

  const figureCells = (figures: ProjectCostFigures, burden = 0) => (
    <>
      <span className={FIGURE_CELL}>{money(figures.plan)}</span>
      <span className={FIGURE_CELL}>{money(figures.budget)}</span>
      <span className={FIGURE_CELL}>{money(figures.committed)}</span>
      {burden !== 0 ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className={cn(FIGURE_CELL, "underline decoration-dotted")}>
              {money(figures.actual - figures.unallowable)}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {t`of which burden: ${money(burden)}`}
          </TooltipContent>
        </Tooltip>
      ) : (
        <span className={FIGURE_CELL}>
          {money(figures.actual - figures.unallowable)}
        </span>
      )}
      <span className={FIGURE_CELL}>{money(figures.unallowable)}</span>
      <span
        className={cn(
          FIGURE_CELL,
          figures.remaining !== null && figures.remaining < 0 && "text-red-500"
        )}
      >
        {money(figures.remaining)}
      </span>
      <span className={FIGURE_CELL}>{money(figures.estimateAtCompletion)}</span>
    </>
  );

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-x-auto">
      <div className="flex h-full min-h-0 min-w-[63rem] flex-col">
        <div className="sticky top-0 z-10 flex h-10 shrink-0 items-center border-b border-border bg-card pr-4 text-xs font-medium text-muted-foreground">
          <div className="min-w-0 flex-1 px-4">
            <Trans>Element</Trans>
          </div>
          <span className={FIGURE_CELL}>
            <Trans>Plan</Trans>
          </span>
          <span className={FIGURE_CELL}>
            <Trans>Budget</Trans>
          </span>
          <span className={FIGURE_CELL}>
            <Trans>Committed</Trans>
          </span>
          <span className={FIGURE_CELL}>
            <Trans>Allowable</Trans>
          </span>
          <span className={FIGURE_CELL}>
            <Trans>Unallowable</Trans>
          </span>
          <span className={FIGURE_CELL}>
            <Trans>Remaining</Trans>
          </span>
          <span className={FIGURE_CELL}>
            <Trans>Estimate</Trans>
          </span>
        </div>
        <div className="flex h-9 shrink-0 items-center border-b border-border bg-muted/40 pr-4 text-sm font-medium">
          <div className="flex min-w-0 flex-1 items-baseline gap-2 px-4">
            <span className="shrink-0">
              <Trans>Project total</Trans>
            </span>
            {serviceOrders.length > 0 && (
              <span className="truncate text-xs font-normal text-muted-foreground">
                <Trans>Actual includes service orders: {serviceAmount}</Trans>
              </span>
            )}
            {preproduction !== null && (
              <span className="truncate text-xs font-normal text-muted-foreground">
                <Trans>Preproduction: {preproductionAmount}</Trans>
              </span>
            )}
          </div>
          {figureCells(project, projectBurden)}
        </div>
        {tree.length === 0 ? (
          <div className="flex-1">
            <Empty />
          </div>
        ) : (
          <TreeView<ProjectCostRow>
            tree={tree}
            nodes={nodes}
            getTreeProps={getTreeProps}
            getNodeProps={getNodeProps}
            virtualizer={virtualizer}
            parentRef={parentRef}
            parentClassName="flex-1 min-h-0"
            renderNode={({ node, state }) => {
              const row = node.data;
              const isOpen = row.id === openElementId;
              return (
                <div
                  className={cn(
                    "flex h-9 cursor-pointer items-center pr-4 text-sm",
                    isOpen || state.selected
                      ? "bg-accent/70"
                      : "hover:bg-accent/40"
                  )}
                  onClick={() =>
                    navigate(path.to.projectCostsElement(projectId, row.id))
                  }
                >
                  <div className="flex h-9 shrink-0 items-center pl-2">
                    {Array.from({ length: node.level }).map((_, index) => (
                      <LevelLine key={index} isSelected={state.selected} />
                    ))}
                    <button
                      type="button"
                      aria-label={
                        state.expanded
                          ? t`Collapse ${row.readableId}`
                          : t`Expand ${row.readableId}`
                      }
                      disabled={!node.hasChildren}
                      className="flex h-9 w-5 items-center justify-center text-muted-foreground"
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleExpandNode(node.id);
                      }}
                    >
                      {node.hasChildren &&
                        (state.expanded ? (
                          <LuChevronDown className="size-4" />
                        ) : (
                          <LuChevronRight className="size-4" />
                        ))}
                    </button>
                  </div>
                  <div className="flex min-w-0 flex-1 items-center gap-2 px-2">
                    <ElementTypeIcon type={row.type} />
                    <span className="shrink-0 whitespace-nowrap font-mono text-xs text-muted-foreground">
                      {row.readableId}
                    </span>
                    <span className="truncate">{row.name}</span>
                    {row.isPreproduction && (
                      <Badge variant="secondary" className="shrink-0">
                        <Trans>Preproduction</Trans>
                      </Badge>
                    )}
                  </div>
                  {figureCells(row.figures, burdenByElement[row.id] ?? 0)}
                </div>
              );
            }}
          />
        )}
        <ServiceOrderCosts rows={serviceOrders} />
        <ProjectBurdenByPool rows={burdenByPool} />
      </div>
    </div>
  );
}
