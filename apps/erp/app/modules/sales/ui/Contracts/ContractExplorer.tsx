// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Button, cn, HStack, VStack } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuCirclePlus } from "react-icons/lu";
import { useNavigate, useParams } from "react-router";
import { Empty, ItemThumbnail } from "~/components";
import {
  useDateFormatter,
  useOptimisticLocation,
  usePermissions,
  useRouteData
} from "~/hooks";
import { path } from "~/utils/path";
import ContractMoney from "./ContractMoney";
import type { ContractLine, ContractRouteData } from "./types";

/** The contract's lines, one-time first then recurring, like a sales order's
 *  line items. */
export default function ContractExplorer() {
  const { t } = useLingui();
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const routeData = useRouteData<ContractRouteData>(path.to.contract(id));
  const permissions = usePermissions();
  const navigate = useNavigate();

  const contract = routeData?.contract;
  const lines = routeData?.lines ?? [];
  const isDraft = contract?.status === "Draft";
  const canAdd = isDraft && permissions.can("create", "sales");

  if (!contract) return null;

  // A line an amendment replaced keeps its history but no longer bills past
  // its end date.
  const replaced = new Set(
    lines
      .map((line) => line.amendsLineId)
      .filter((lineId): lineId is string => Boolean(lineId))
  );
  const groups = [
    {
      key: "One-time",
      label: t`One-time`,
      lines: lines.filter((line) => line.revenueType === "One-time")
    },
    {
      key: "Recurring",
      label: t`Recurring`,
      lines: lines.filter((line) => line.revenueType === "Recurring")
    }
  ].filter((group) => group.lines.length > 0);

  const addLine = () => navigate(path.to.newContractLine(id));

  return (
    <VStack className="w-full h-[calc(100dvh-var(--topbar-height)-var(--header-height)-var(--content-inset))] justify-between">
      <VStack
        className="flex-1 overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent"
        spacing={0}
      >
        {groups.length > 0 ? (
          groups.map((group) => (
            <VStack key={group.key} spacing={0}>
              <h3 className="w-full px-2 pt-3 pb-1 text-xxs text-foreground/70 uppercase font-light tracking-wide border-b">
                {group.label}
              </h3>
              {group.lines.map((line) => (
                <ExplorerLine
                  key={line.id}
                  contractId={id}
                  line={line}
                  currencyCode={contract.currencyCode}
                  isReplaced={replaced.has(line.id)}
                />
              ))}
            </VStack>
          ))
        ) : (
          <Empty>
            {isDraft && (
              <Button
                isDisabled={!canAdd}
                leftIcon={<LuCirclePlus />}
                variant="secondary"
                onClick={addLine}
              >
                <Trans>Add Line</Trans>
              </Button>
            )}
          </Empty>
        )}
      </VStack>
      {isDraft && (
        <div className="w-full flex border-t border-border p-4">
          <Button
            className="w-full"
            isDisabled={!canAdd}
            leftIcon={<LuCirclePlus />}
            variant="secondary"
            onClick={addLine}
          >
            <Trans>Add Line</Trans>
          </Button>
        </div>
      )}
    </VStack>
  );
}

function ExplorerLine({
  contractId,
  line,
  currencyCode,
  isReplaced
}: {
  contractId: string;
  line: ContractLine;
  currencyCode: string | null;
  isReplaced: boolean;
}) {
  const { t } = useLingui();
  const location = useOptimisticLocation();
  const navigate = useNavigate();
  const { formatDate } = useDateFormatter();

  const to = path.to.contractLine(contractId, line.id);
  const isSelected = location.pathname === to;

  const rateUnitLabels: Record<
    NonNullable<ContractLine["rateUnit"]>,
    string
  > = {
    Day: t`per day`,
    Week: t`per week`,
    Month: t`per month`,
    Quarter: t`per quarter`,
    Year: t`per year`
  };
  const title = line.description || line.item?.name || line.itemId;

  return (
    <HStack
      className={cn(
        "group w-full p-2 items-center border-b hover:bg-accent/30 cursor-pointer",
        isSelected && "bg-accent/60 hover:bg-accent/50"
      )}
      onClick={() => {
        if (!isSelected) navigate(to);
      }}
    >
      <HStack spacing={2} className="flex-grow min-w-0">
        <ItemThumbnail type="Service" />
        <VStack spacing={0} className="min-w-0 flex-1">
          <span
            className={cn(
              "font-semibold line-clamp-1 w-full",
              isReplaced && "line-through text-muted-foreground"
            )}
          >
            {title}
          </span>
          <span className="text-muted-foreground text-xs truncate w-full">
            <span className="tabular-nums">{Number(line.quantity)}</span>
            {" × "}
            <ContractMoney value={line.rate} currencyCode={currencyCode} rate />
            {line.revenueType === "Recurring" && line.rateUnit
              ? ` ${rateUnitLabels[line.rateUnit]}`
              : ""}
          </span>
          {isReplaced && line.endDate && (
            <span className="text-muted-foreground text-xs truncate w-full">
              <Trans>until {formatDate(line.endDate)}</Trans>
            </span>
          )}
        </VStack>
      </HStack>
    </HStack>
  );
}
