// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Badge, Td, Th } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuWorkflow } from "react-icons/lu";
import { Link, useLocation, useNavigate } from "react-router";
import { useWorkCenters } from "~/components/Form/WorkCenters";
import { OperationTypeIcon } from "~/components/Icons";
import { path } from "~/utils/path";
import type { PartMethodPage } from "../../items.service";
import { useMethodAccess } from "./MethodPageFrame";
import { OperationRowTitle } from "./MethodRow";
import { MethodTable, MethodTableRow, useMethodLines } from "./MethodTable";
import { getMethodSearch, getOperationTabSources } from "./methodPageUtils";

export function OperationTypeLabel({ type }: { type?: string | null }) {
  switch (type) {
    case "Assembly":
      return <Trans>Assembly</Trans>;
    case "Inspection":
      return <Trans>Inspection</Trans>;
    case "Outside Processing":
      return <Trans>Outside Processing</Trans>;
    default:
      return <Trans>Process</Trans>;
  }
}

const formatTime = (time?: number | null, unit?: string | null) =>
  time ? `${time} ${unit ?? ""}` : "—";

export function BillOfProcessTable({
  itemId,
  page
}: {
  itemId: string;
  page: PartMethodPage;
}) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const { search: currentSearch } = useLocation();
  const search = getMethodSearch(currentSearch);
  const { isReadOnly } = useMethodAccess(page);
  const workCenters = useWorkCenters();
  const lines = useMethodLines({
    lines: page.methodOperations,
    orderAction: path.to.methodOperationsOrder,
    deleteAction: path.to.methodOperationsDelete,
    isReadOnly
  });

  return (
    <MethodTable
      page={page}
      title={<Trans>Bill of Process</Trans>}
      addLabel={<Trans>Add Operation</Trans>}
      onAdd={() => navigate(`${path.to.partBillOfProcessNew(itemId)}${search}`)}
      lines={lines}
      emptyIcon={<LuWorkflow />}
      emptyHeading={<Trans>No operations yet</Trans>}
      emptyDescription={<Trans>Add the operations that make this item.</Trans>}
      configureField={`billOfProcess:${page.makeMethod.id}:undefined`}
      configureLabel={t`Bill of Process`}
      configureOptions={lines.sorted.map((operation) => operation.description)}
      head={
        <>
          <Th className="px-2">
            <Trans>Operation</Trans>
          </Th>
          <Th className="px-2 @max-[34rem]:hidden">
            <Trans>Operation Type</Trans>
          </Th>
          <Th className="px-2 @max-[42rem]:hidden">
            <Trans>Work Center</Trans>
          </Th>
          <Th className="px-2 @max-[60rem]:hidden">
            <Trans>Setup</Trans>
          </Th>
          <Th className="px-2">
            <Trans>Labor</Trans>
          </Th>
          <Th className="px-2 @max-[60rem]:hidden">
            <Trans>Machine</Trans>
          </Th>
          <Th className="px-2 @max-[40rem]:hidden">
            <Trans>Steps</Trans>
          </Th>
          <Th className="px-2 @max-[48rem]:hidden">
            <Trans>Tools</Trans>
          </Th>
        </>
      }
    >
      {lines.sorted.map((operation) => {
        const to = `${path.to.partBillOfProcessOperation(itemId, operation.id!)}${search}`;
        const sources = getOperationTabSources(operation);
        const isOutside = operation.operationType === "Outside Processing";
        return (
          <MethodTableRow
            key={operation.id}
            id={operation.id!}
            to={to}
            lines={lines}
            isReadOnly={isReadOnly}
          >
            <Td className="min-w-48 whitespace-normal px-2">
              <Link to={to} onClick={(event) => event.stopPropagation()}>
                <OperationRowTitle
                  description={operation.description}
                  operationType={operation.operationType}
                  processId={operation.processId}
                  supplierProcessId={operation.operationSupplierProcessId}
                />
              </Link>
            </Td>
            <Td className="whitespace-nowrap px-2 @max-[34rem]:hidden">
              <Badge variant="secondary">
                <OperationTypeIcon
                  type={operation.operationType}
                  className="mr-1 size-3"
                />
                <OperationTypeLabel type={operation.operationType} />
              </Badge>
            </Td>
            <Td className="whitespace-nowrap px-2 @max-[42rem]:hidden">
              {isOutside
                ? "—"
                : (workCenters.find(
                    (option) => option.value === operation.workCenterId
                  )?.label ?? "—")}
            </Td>
            <Td className="whitespace-nowrap px-2 tabular-nums @max-[60rem]:hidden">
              {isOutside
                ? "—"
                : formatTime(operation.setupTime, operation.setupUnit)}
            </Td>
            <Td className="whitespace-nowrap px-2 tabular-nums">
              {isOutside
                ? "—"
                : formatTime(operation.laborTime, operation.laborUnit)}
            </Td>
            <Td className="whitespace-nowrap px-2 tabular-nums @max-[60rem]:hidden">
              {operation.operationType === "Process"
                ? formatTime(operation.machineTime, operation.machineUnit)
                : "—"}
            </Td>
            <Td className="whitespace-nowrap px-2 tabular-nums @max-[40rem]:hidden">
              {sources.steps === "procedure" ? (
                <Badge variant="secondary">
                  <Trans>Procedure</Trans>
                </Badge>
              ) : sources.steps === "linked" ? (
                <Badge variant="secondary">
                  {operation.assemblyInstructionId ? (
                    <Trans>Assembly Instruction</Trans>
                  ) : (
                    <Trans>Inspection Plan</Trans>
                  )}
                </Badge>
              ) : sources.steps === "notUsed" ? (
                "—"
              ) : (
                operation.methodOperationStep.length
              )}
            </Td>
            <Td className="whitespace-nowrap px-2 tabular-nums @max-[48rem]:hidden">
              {isOutside ? "—" : operation.methodOperationTool.length}
            </Td>
          </MethodTableRow>
        );
      })}
    </MethodTable>
  );
}
