// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useAction } from "@carbon/query";
import {
  Button,
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  toast
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo, useRef, useState } from "react";
import {
  LuCornerDownRight,
  LuEllipsis,
  LuGitBranch,
  LuPlus,
  LuTrash,
  LuX
} from "react-icons/lu";
import { Link, useParams } from "react-router";
import ConfirmDelete from "~/components/Modals/ConfirmDelete";
import { useCurrencyFormatter, useQuantityFormatter } from "~/hooks";
import { ElementTypeIcon } from "~/modules/projects/ui/Elements/ElementTypeIcon";
import { path } from "~/utils/path";
import type { ServiceNodeType, WorkTotals } from "../../service.models";
import { inTreeOrder, serviceNodeTypes } from "../../service.models";
import type { ServiceWorkNode } from "../../types";
import { CoveragePill } from "./CoveragePill";

const EMPTY_TOTALS: WorkTotals = {
  hours: 0,
  partCost: 0,
  cost: 0,
  billable: 0,
  coverages: []
};

/**
 * A service order's work: its nodes as an indented list with what each has
 * cost and will bill, its subtree included. A node opens its peek. A user
 * who may update service adds System, Task and Folder nodes, and deletes a
 * node with no charges.
 */
export default function WorkTree({
  nodes,
  totals,
  isDisabled,
  onBuildTree
}: {
  nodes: ServiceWorkNode[];
  totals: Map<string, WorkTotals>;
  isDisabled: boolean;
  onBuildTree: () => void;
}) {
  const { t } = useLingui();
  const { id, elementId } = useParams();
  if (!id) throw new Error("id not found");

  const formatCurrency = useCurrencyFormatter();
  const formatQuantity = useQuantityFormatter();
  const rows = useMemo(() => inTreeOrder(nodes), [nodes]);

  const [parent, setParent] = useState<ServiceWorkNode | null>(null);
  const [type, setType] = useState<ServiceNodeType>("Task");
  const [name, setName] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  const [deleting, setDeleting] = useState<ServiceWorkNode | null>(null);

  const addFetcher = useAction<{ error?: { message: string } | null }>({
    onSuccess: () => {
      setName("");
      nameRef.current?.focus();
    },
    onError: (data) =>
      toast.error(data?.error?.message ?? t`Failed to add the node`)
  });

  const typeLabels: Record<ServiceNodeType, string> = {
    System: t`System`,
    Task: t`Task`,
    Folder: t`Folder`
  };

  const addNode = () => {
    if (!name.trim()) return;
    addFetcher.submit(
      {
        intent: "add",
        type,
        name: name.trim(),
        parentId: parent?.id ?? ""
      },
      { method: "post", action: path.to.serviceOrderWork(id) }
    );
  };

  return (
    <Card>
      <HStack className="justify-between items-start">
        <CardHeader>
          <CardTitle>
            <Trans>Work</Trans>
          </CardTitle>
        </CardHeader>
        <CardAction>
          <Button
            variant="secondary"
            leftIcon={<LuGitBranch />}
            isDisabled={isDisabled}
            onClick={onBuildTree}
          >
            <Trans>Build Tree</Trans>
          </Button>
        </CardAction>
      </HStack>
      <CardContent className="flex flex-col gap-4">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            <Trans>
              No work yet. Build the tree from the unit, or add the first node.
            </Trans>
          </p>
        ) : (
          <Table>
            <Thead>
              <Tr>
                <Th className="w-full">
                  <Trans>Node</Trans>
                </Th>
                <Th>
                  <Trans>Coverage</Trans>
                </Th>
                <Th className="text-right">
                  <Trans>Hours</Trans>
                </Th>
                <Th className="text-right">
                  <Trans>Part Cost</Trans>
                </Th>
                <Th className="text-right">
                  <Trans>Cost</Trans>
                </Th>
                <Th className="text-right">
                  <Trans>Billable</Trans>
                </Th>
                <Th className="text-right">
                  <Trans>Fixed Price</Trans>
                </Th>
                <Th />
              </Tr>
            </Thead>
            <Tbody>
              {rows.map(({ node, depth }) => {
                const nodeTotals = totals.get(node.id) ?? EMPTY_TOTALS;
                return (
                  <Tr
                    key={node.id}
                    className={cn(
                      "hover:bg-accent/30",
                      elementId === node.id && "bg-accent/60"
                    )}
                  >
                    <Td>
                      <Link
                        to={path.to.serviceOrderWorkNode(id, node.id)}
                        className="flex min-w-0 items-center gap-2"
                        style={{ paddingLeft: `${depth * 1.25}rem` }}
                      >
                        <ElementTypeIcon type={node.type} />
                        <span className="shrink-0 whitespace-nowrap font-mono text-xs text-muted-foreground">
                          {node.readableId}
                        </span>
                        <span className="truncate">{node.name}</span>
                        {node.trackedEntity?.readableId && (
                          <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
                            {node.trackedEntity.readableId}
                          </span>
                        )}
                      </Link>
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        {nodeTotals.coverages.map((coverage) => (
                          <CoveragePill key={coverage} coverage={coverage} />
                        ))}
                      </div>
                    </Td>
                    <Td className="text-right tabular-nums">
                      {formatQuantity(nodeTotals.hours)}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {formatCurrency.format(nodeTotals.partCost)}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {formatCurrency.format(nodeTotals.cost)}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {formatCurrency.format(nodeTotals.billable)}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {node.fixedPrice === null
                        ? "—"
                        : formatCurrency.format(Number(node.fixedPrice))}
                    </Td>
                    <Td>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <IconButton
                            aria-label={t`More options`}
                            icon={<LuEllipsis />}
                            variant="ghost"
                            size="sm"
                          />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            disabled={isDisabled}
                            onClick={() => {
                              setParent(node);
                              nameRef.current?.focus();
                            }}
                          >
                            <DropdownMenuIcon icon={<LuCornerDownRight />} />
                            <Trans>Add Child Node</Trans>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            destructive
                            disabled={isDisabled || nodeTotals.cost !== 0}
                            onClick={() => setDeleting(node)}
                          >
                            <DropdownMenuIcon icon={<LuTrash />} />
                            <Trans>Delete Node</Trans>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
        )}

        {!isDisabled && (
          <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
            {parent && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground min-w-0">
                <LuCornerDownRight className="shrink-0" />
                <span className="truncate">
                  <Trans>
                    Under {parent.readableId} {parent.name}
                  </Trans>
                </span>
                <IconButton
                  aria-label={t`Add at the top level`}
                  icon={<LuX />}
                  variant="ghost"
                  size="sm"
                  onClick={() => setParent(null)}
                />
              </div>
            )}
            <div className="flex flex-col gap-2 @container sm:flex-row">
              <div className="sm:w-36 shrink-0">
                <Select
                  value={type}
                  onValueChange={(value) => setType(value as ServiceNodeType)}
                >
                  <SelectTrigger aria-label={t`Node type`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {serviceNodeTypes.map((value) => (
                      <SelectItem key={value} value={value}>
                        {typeLabels[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Input
                ref={nameRef}
                value={name}
                placeholder={t`Name the node`}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addNode();
                  }
                }}
              />
              <Button
                variant="secondary"
                leftIcon={<LuPlus />}
                isLoading={addFetcher.state !== "idle"}
                isDisabled={!name.trim() || addFetcher.state !== "idle"}
                onClick={addNode}
              >
                <Trans>Add Node</Trans>
              </Button>
            </div>
          </div>
        )}
      </CardContent>

      {deleting && (
        <ConfirmDelete
          action={path.to.serviceOrderWork(id)}
          isOpen
          name={`${deleting.readableId} ${deleting.name}`}
          text={t`Are you sure you want to delete ${deleting.readableId} and the nodes under it? This cannot be undone.`}
          fields={{ intent: "delete", elementId: deleting.id }}
          onCancel={() => setDeleting(null)}
          onSubmit={() => setDeleting(null)}
        />
      )}
    </Card>
  );
}
