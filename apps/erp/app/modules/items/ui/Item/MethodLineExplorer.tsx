// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Button, cn, Spinner } from "@carbon/react";
import { getItemReadableId } from "@carbon/utils";
import { Trans } from "@lingui/react/macro";
import { LuCirclePlus } from "react-icons/lu";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import { useItems } from "~/stores";
import { path } from "~/utils/path";
import type { PartMethodPage } from "../../items.service";
import { OperationTypeLabel } from "./BillOfProcessTable";
import { useMethodAccess } from "./MethodPageFrame";
import { getMethodSearch, getPartMethodTab } from "./methodPageUtils";

/** The lines of the open method tab, so the next line is one click away. */
export function MethodLineExplorer({
  itemId,
  filterText
}: {
  itemId: string;
  filterText: string;
}) {
  const location = useLocation();
  const isProcess = getPartMethodTab(location.pathname) === "bill-of-process";
  const page = useRouteData<PartMethodPage>(
    isProcess
      ? path.to.partBillOfProcess(itemId)
      : path.to.partBillOfMaterial(itemId)
  );

  if (!page) {
    return (
      <div className="flex w-full items-center justify-center p-4">
        <Spinner className="size-6" />
      </div>
    );
  }

  return (
    <MethodLines
      itemId={itemId}
      page={page}
      isProcess={isProcess}
      filterText={filterText}
    />
  );
}

function MethodLines({
  itemId,
  page,
  isProcess,
  filterText
}: {
  itemId: string;
  page: PartMethodPage;
  isProcess: boolean;
  filterText: string;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();
  const search = location.search;
  const [items] = useItems();
  const { isReadOnly } = useMethodAccess(page);
  const query = filterText.trim().toLowerCase();

  const operations = [...page.methodOperations].sort(
    (a, b) => a.order - b.order
  );
  const materials = [...page.methodMaterials].sort((a, b) => a.order - b.order);

  const lines = isProcess
    ? operations.map((operation) => ({
        id: operation.id!,
        title: operation.description,
        searchText: operation.description,
        subtitle: <OperationTypeLabel type={operation.operationType} />,
        to: path.to.partBillOfProcessOperation(itemId, operation.id!)
      }))
    : materials.map((material) => ({
        id: material.id!,
        title: getItemReadableId(items, material.itemId) ?? "",
        searchText: `${getItemReadableId(items, material.itemId) ?? ""} ${material.description}`,
        subtitle: material.description,
        to: path.to.partBillOfMaterialLine(itemId, material.id!)
      }));
  const selectedId = isProcess ? params.operationId : params.lineId;

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto p-2">
        {lines
          .filter(
            (line) => !query || line.searchText.toLowerCase().includes(query)
          )
          .map((line) => (
            <Link
              key={line.id}
              to={`${line.to}${search}`}
              aria-current={line.id === selectedId ? "page" : undefined}
              className={cn(
                "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/30",
                line.id === selectedId && "bg-accent/60"
              )}
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{line.title}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {line.subtitle}
                </span>
              </span>
            </Link>
          ))}
      </div>
      <div className="shrink-0 border-t border-border p-2">
        <Button
          className="w-full"
          variant="secondary"
          leftIcon={<LuCirclePlus />}
          isDisabled={isReadOnly}
          onClick={() =>
            navigate(
              `${isProcess ? path.to.partBillOfProcessNew(itemId) : path.to.partBillOfMaterialNew(itemId)}${getMethodSearch(search)}`
            )
          }
        >
          {isProcess ? <Trans>Add Operation</Trans> : <Trans>Add Item</Trans>}
        </Button>
      </div>
    </div>
  );
}
