// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  missingPullFromLocations,
  needsPullFrom
} from "@carbon/database/strict-backflush";
import { Badge, Td, Th } from "@carbon/react";
import { getItemReadableId } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuPackage } from "react-icons/lu";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import {
  MethodIcon,
  MethodItemTypeIcon,
  SourcingTypeIcon,
  TrackingTypeIcon
} from "~/components";
import { useQuantityFormatter } from "~/hooks";
import { usePullFromLocationIds } from "~/hooks/usePullFromLocationIds";
import { useItems } from "~/stores";
import { path } from "~/utils/path";
import type { PartMethodPage } from "../../items.service";
import { useMethodAccess } from "./MethodPageFrame";
import {
  ItemTypeLabel,
  MaterialRowTitle,
  MethodTypeLabel,
  TrackingLabel
} from "./MethodRow";
import { MethodTable, MethodTableRow, useMethodLines } from "./MethodTable";
import { getMethodSearch } from "./methodPageUtils";

const RULE_FIELDS = ["itemId", "quantity", "unitOfMeasureCode", "methodType"];

export function BillOfMaterialTable({
  itemId,
  page,
  replenishmentSystem
}: {
  itemId: string;
  page: PartMethodPage;
  replenishmentSystem?: string | null;
}) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const { search: currentSearch } = useLocation();
  const [searchParams] = useSearchParams();
  const search = getMethodSearch(currentSearch);
  const { isReadOnly } = useMethodAccess(page);
  const [items] = useItems();
  const formatQuantity = useQuantityFormatter();
  const pullFromLocationIds = usePullFromLocationIds();
  const lines = useMethodLines({
    lines: page.methodMaterials,
    orderAction: path.to.methodMaterialsOrder,
    deleteAction: path.to.deleteMethodMaterials,
    isReadOnly
  });

  const showSourcing = replenishmentSystem === "Buy and Make";
  const ruleFields = new Set(page.configurationRules.map((rule) => rule.field));

  return (
    <MethodTable
      page={page}
      title={<Trans>Bill of Material</Trans>}
      addLabel={<Trans>Add Item</Trans>}
      onAdd={() =>
        navigate(`${path.to.partBillOfMaterialNew(itemId)}${search}`)
      }
      lines={lines}
      emptyIcon={<LuPackage />}
      emptyHeading={<Trans>No materials yet</Trans>}
      emptyDescription={<Trans>Add the materials this item uses.</Trans>}
      configureField={`billOfMaterial:${page.makeMethod.id}:${searchParams.get("materialId")}`}
      configureLabel={t`Bill of Material`}
      configureOptions={lines.sorted
        .map((material) => getItemReadableId(items, material.itemId) ?? "")
        .filter((id) => !!id)}
      head={
        <>
          <Th className="px-2">
            <Trans>Item</Trans>
          </Th>
          <Th className="px-2">
            <Trans>Quantity</Trans>
          </Th>
          <Th className="px-2 @max-[34rem]:hidden">
            <Trans>Method Type</Trans>
          </Th>
          {showSourcing && (
            <Th className="px-2 @max-[60rem]:hidden">
              <Trans>Sourcing Type</Trans>
            </Th>
          )}
          <Th className="px-2 @max-[60rem]:hidden">
            <Trans>Type</Trans>
          </Th>
          <Th className="px-2 @max-[44rem]:hidden">
            <Trans>Operation</Trans>
          </Th>
        </>
      }
    >
      {lines.sorted.map((material) => {
        const to = `${path.to.partBillOfMaterialLine(itemId, material.id!)}${search}`;
        const tracking = material.item?.itemTrackingType;
        const operation = page.methodOperations.find(
          (candidate) => candidate.id === material.methodOperationId
        );
        const missingPullFrom =
          pullFromLocationIds !== null &&
          needsPullFrom({
            methodType: material.methodType,
            itemType: material.itemType,
            itemTrackingType: tracking ?? null
          }) &&
          missingPullFromLocations(
            (material.storageUnitIds ?? {}) as Record<string, string>,
            pullFromLocationIds
          ).length > 0;

        return (
          <MethodTableRow
            key={material.id}
            id={material.id!}
            to={to}
            lines={lines}
            isReadOnly={isReadOnly}
          >
            <Td className="min-w-48 whitespace-normal px-2">
              <Link to={to} onClick={(event) => event.stopPropagation()}>
                <MaterialRowTitle
                  readableId={getItemReadableId(items, material.itemId)}
                  description={material.description}
                  itemId={material.itemId}
                  itemType={material.itemType}
                  supersessionMode={
                    items.find((item) => item.id === material.itemId)
                      ?.supersessionMode
                  }
                  hasRules={RULE_FIELDS.some((field) =>
                    ruleFields.has(`${field}:${material.id}`)
                  )}
                  missingPullFrom={missingPullFrom}
                />
              </Link>
            </Td>
            <Td className="whitespace-nowrap px-2 tabular-nums">
              {formatQuantity(material.quantity ?? 0)}{" "}
              <span className="text-muted-foreground">
                {material.unitOfMeasureCode}
              </span>
            </Td>
            <Td className="whitespace-nowrap px-2 @max-[34rem]:hidden">
              <Badge variant="secondary">
                <MethodIcon
                  type={material.methodType}
                  isKit={material.kit ?? undefined}
                  className="mr-1 size-3"
                />
                <MethodTypeLabel type={material.methodType} />
              </Badge>
              {material.kit && (
                <Badge variant="secondary" className="ml-1">
                  <Trans>Kit</Trans>
                </Badge>
              )}
            </Td>
            {showSourcing && (
              <Td className="whitespace-nowrap px-2 @max-[60rem]:hidden">
                <span className="inline-flex items-center gap-1">
                  <SourcingTypeIcon
                    type={material.sourcingType}
                    className="size-3"
                  />
                  {material.sourcingType}
                </span>
              </Td>
            )}
            <Td className="whitespace-nowrap px-2 @max-[60rem]:hidden">
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <MethodItemTypeIcon
                  type={material.itemType}
                  className="size-3"
                />
                <ItemTypeLabel type={material.itemType} />
              </span>
              {(tracking === "Batch" || tracking === "Serial") && (
                <Badge variant="secondary" className="ml-1">
                  <TrackingTypeIcon type={tracking} className="mr-1 size-3" />
                  <TrackingLabel type={tracking} />
                </Badge>
              )}
            </Td>
            <Td className="min-w-32 whitespace-normal px-2 @max-[44rem]:hidden">
              {operation ? (
                operation.description
              ) : (
                <span className="whitespace-nowrap text-muted-foreground">
                  <Trans>First Operation</Trans>
                </span>
              )}
            </Td>
          </MethodTableRow>
        );
      })}
    </MethodTable>
  );
}
