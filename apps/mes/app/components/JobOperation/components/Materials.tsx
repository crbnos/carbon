// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Badge,
  Button,
  cn,
  HStack,
  IconButton,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  useViewport,
  VStack
} from "@carbon/react";
import { getItemReadableId } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { Fragment } from "react";
import {
  LuArrowLeft,
  LuGitBranchPlus,
  LuGitPullRequest,
  LuPackageCheck,
  LuQrCode,
  LuTriangleAlert
} from "react-icons/lu";
import { MethodIcon, TrackingTypeIcon } from "~/components/Icons";
import type { JobMaterialPickedItem } from "~/services/inventory.service";
import type { BatchMaterialTotal } from "~/services/operations.service";
import type { JobMaterial } from "~/services/types";
import { useItems } from "~/stores";

type MaterialRow = {
  material: JobMaterial;
  isKitChild: boolean;
  /** Kit children take their parent's. */
  isRelatedToOperation: boolean;
  /** Untracked stock issues directly, tracked stock by scan; Make to Order has neither. */
  issue: "direct" | "scan" | null;
  /** The tracked issue still owed by this operation. */
  isPrimaryIssue: boolean;
  /** Batched operations, parent rows only. */
  batchTotal?: BatchMaterialTotal;
};

type MaterialGroup = { parent: MaterialRow; kitChildren: MaterialRow[] };

function toMaterialGroups({
  materials,
  operationId,
  batchMaterialTotals
}: {
  materials: JobMaterial[];
  operationId: string;
  batchMaterialTotals?: Record<string, BatchMaterialTotal> | null;
}): MaterialGroup[] {
  const baseMaterials = materials.filter((m) => !m.isKitComponent);
  const kitChildrenByParentId = new Map<string, JobMaterial[]>();
  for (const m of materials) {
    if (!m.isKitComponent || !m.kitParentId) continue;
    kitChildrenByParentId.set(m.kitParentId, [
      ...(kitChildrenByParentId.get(m.kitParentId) ?? []),
      m
    ]);
  }

  const issueOf = (material: JobMaterial): MaterialRow["issue"] => {
    if (material.requiresBatchTracking || material.requiresSerialTracking) {
      return "scan";
    }
    return material.methodType !== "Make to Order" &&
      material.requiresBatchTracking === false &&
      material.requiresSerialTracking === false
      ? "direct"
      : null;
  };

  return baseMaterials.map((material) => {
    const isRelatedToOperation = material.jobOperationId === operationId;
    const someRelatedMaterialIsIssued = baseMaterials.some(
      (m) =>
        m.itemReadableIdWithoutRevision ===
          material.itemReadableIdWithoutRevision &&
        ((m.quantityIssued ?? 0) > 0 || (material.quantityIssued ?? 0) > 0)
    );
    const issue = issueOf(material);
    return {
      parent: {
        material,
        isKitChild: false,
        isRelatedToOperation,
        issue,
        isPrimaryIssue:
          issue === "scan" &&
          isRelatedToOperation &&
          !someRelatedMaterialIsIssued,
        batchTotal: material.itemId
          ? batchMaterialTotals?.[material.itemId]
          : undefined
      },
      kitChildren: (
        (material.id && kitChildrenByParentId.get(material.id)) ||
        []
      ).map((child) => ({
        material: child,
        isKitChild: true,
        isRelatedToOperation,
        issue: issueOf(child),
        isPrimaryIssue: false
      }))
    };
  });
}

function isTracked(material: JobMaterial) {
  return material.requiresBatchTracking || material.requiresSerialTracking;
}

function estimatedQuantity(material: JobMaterial, parentIsSerial: boolean) {
  return parentIsSerial && isTracked(material)
    ? `${material.quantity ?? material.estimatedQuantity}/${
        material.estimatedQuantity ?? material.quantity
      }`
    : (material.estimatedQuantity ?? material.quantity);
}

function actualQuantity(material: JobMaterial, parentIsSerial: boolean) {
  if (
    material.methodType === "Make to Order" &&
    material.requiresBatchTracking === false &&
    material.requiresSerialTracking === false
  ) {
    return <MethodIcon type="Make to Order" isKit={material.kit ?? false} />;
  }
  return parentIsSerial && isTracked(material)
    ? `${material.quantityIssued}/${
        material.quantity ?? material.estimatedQuantity
      }`
    : material.quantityIssued;
}

/**
 * Additive overlay badge showing how much of a material has been picked (staged at
 * lineside). Picking is optional, so this renders nothing unless something has actually
 * been picked — orange while partial, green once the full requirement is staged.
 */
function PickedBadge({
  quantityPicked,
  quantityToPick
}: {
  quantityPicked?: number | null;
  quantityToPick?: number | null;
}) {
  const picked = Number(quantityPicked ?? 0);
  if (picked <= 0) return null;
  const toPick = Number(quantityToPick ?? 0);
  const isFullyPicked = toPick > 0 && picked >= toPick;
  return (
    <Badge
      variant={isFullyPicked ? "green" : "orange"}
      className="gap-1 shrink-0"
      title="Quantity picked to lineside"
    >
      <LuPackageCheck className="size-3" />
      {isFullyPicked ? <Trans>Picked</Trans> : `${picked}/${toPick}`}
    </Badge>
  );
}

function PickedBreakdown({
  materialItemId,
  pickedByItem
}: {
  materialItemId: string | null | undefined;
  pickedByItem?: JobMaterialPickedItem[] | null;
}) {
  const picks = pickedByItem ?? [];
  if (!picks.some((p) => p.itemId !== materialItemId)) return null;
  return (
    <div className="flex flex-wrap items-center gap-1 text-xs text-blue-700 dark:text-blue-300">
      <span>
        <Trans>Picked as</Trans>
      </span>
      {picks.map((pick) => {
        const isFullyPicked =
          pick.quantityToPick > 0 && pick.quantityPicked >= pick.quantityToPick;
        return (
          <Badge
            key={pick.itemId}
            variant={
              isFullyPicked
                ? "green"
                : pick.quantityPicked > 0
                  ? "orange"
                  : "secondary"
            }
            className="gap-1 shrink-0"
          >
            {isFullyPicked
              ? pick.quantityPicked
              : `${pick.quantityPicked}/${pick.quantityToPick}`}
            {" × "}
            {pick.itemReadableId}
          </Badge>
        );
      })}
    </div>
  );
}

function TrackingBadge({ material }: { material: JobMaterial }) {
  const type = material.requiresBatchTracking
    ? "Batch"
    : material.requiresSerialTracking
      ? "Serial"
      : null;
  if (!type) return null;
  return (
    <Badge variant="secondary">
      <TrackingTypeIcon type={type} className="shrink-0" />
    </Badge>
  );
}

function ExpiredConsumedBadge({ material }: { material: JobMaterial }) {
  if (!material.hasExpiredConsumed) return null;
  return (
    <Badge
      variant="red"
      className="gap-1 shrink-0"
      title="A consumed batch or serial is now past its expiry date."
    >
      <LuTriangleAlert className="size-3" />
      <Trans>Consumed expired</Trans>
    </Badge>
  );
}

type OperationMaterialsProps = {
  materials: JobMaterial[];
  operationId: string;
  parentIsSerial: boolean;
  /** Only for batched operations. */
  batchMaterialTotals?: Record<string, BatchMaterialTotal> | null;
  onIssue: (material: JobMaterial) => void;
};

/** The operation's materials: a table from md, a list on phones. */
export function OperationMaterials(props: OperationMaterialsProps) {
  const { isPhone } = useViewport();
  const groups = toMaterialGroups(props);
  return isPhone ? (
    <MaterialsList {...props} groups={groups} />
  ) : (
    <MaterialsTable {...props} groups={groups} />
  );
}

type LayoutProps = OperationMaterialsProps & { groups: MaterialGroup[] };

function MaterialsTable({ groups, parentIsSerial, onIssue }: LayoutProps) {
  const { t } = useLingui();
  const [items] = useItems();

  const issueButton = (row: MaterialRow) =>
    row.issue === "direct" ? (
      <IconButton
        aria-label={t`Issue Material`}
        variant="ghost"
        icon={<LuGitBranchPlus />}
        className="h-8 w-8"
        onClick={() => onIssue(row.material)}
      />
    ) : row.issue === "scan" && row.isKitChild ? (
      <IconButton
        aria-label={t`Issue Material`}
        variant="secondary"
        icon={<LuQrCode />}
        className="h-8 w-8"
        onClick={() => onIssue(row.material)}
      />
    ) : row.issue === "scan" ? (
      <Button
        className="flex-shrink-0"
        size="lg"
        variant={row.isPrimaryIssue ? "primary" : "secondary"}
        leftIcon={<LuQrCode />}
        onClick={() => onIssue(row.material)}
      >
        <Trans>Issue</Trans>
      </Button>
    ) : null;

  const methodBadge = (material: JobMaterial) => (
    <Badge variant="secondary">
      <MethodIcon
        type={material.methodType ?? ""}
        isKit={material.kit ?? false}
        className="mr-2"
      />
      {material.methodType === "Make to Order" && material.kit
        ? t`Kit`
        : material.methodType}
    </Badge>
  );

  const fadedIfUnrelated = (row: MaterialRow) =>
    !row.isRelatedToOperation && "opacity-50 hover:opacity-100";

  return (
    <div className="w-full overflow-hidden rounded-lg border bg-card">
      <Table className="w-full text-base">
        <Thead className="bg-muted/40">
          <Tr>
            <Th className="text-sm">
              <Trans>Part</Trans>
            </Th>
            <Th className="text-sm lg:table-cell hidden">
              <Trans>Source</Trans>
            </Th>
            <Th className="text-sm">
              <Trans>Estimated</Trans>
            </Th>
            <Th className="text-sm">
              <Trans>Actual</Trans>
            </Th>
            <Th className="text-right" />
          </Tr>
        </Thead>
        <Tbody className="[&>tr]:border-b [&>tr:last-child]:border-0">
          {groups.length === 0 ? (
            <Tr>
              <Td
                colSpan={24}
                className="py-8 text-muted-foreground text-center"
              >
                <Trans>No materials</Trans>
              </Td>
            </Tr>
          ) : (
            groups.map(({ parent, kitChildren }) => {
              const { material, batchTotal } = parent;
              return (
                <Fragment key={`material-${material.id}`}>
                  <Tr className={cn("[&>td]:py-3", fadedIfUnrelated(parent))}>
                    <Td className="max-w-[20vw]">
                      <HStack spacing={2} className="justify-between min-w-0">
                        <VStack spacing={0} className="min-w-0">
                          <span className="font-semibold text-base truncate max-w-full">
                            {getItemReadableId(items, material.itemId ?? "")}
                          </span>
                          <span className="text-muted-foreground text-sm truncate max-w-full">
                            {material.description}
                          </span>
                          <PickedBreakdown
                            materialItemId={material.itemId}
                            pickedByItem={material.pickedByItem}
                          />
                        </VStack>
                        <TrackingBadge material={material} />
                        <ExpiredConsumedBadge material={material} />
                        <PickedBadge
                          quantityPicked={material.quantityPicked}
                          quantityToPick={material.quantityToPick}
                        />
                      </HStack>
                    </Td>
                    <Td className="hidden lg:table-cell">
                      <div className="flex flex-row items-center gap-1">
                        {methodBadge(material)}
                        <LuArrowLeft
                          className={cn(
                            material.methodType === "Make to Order"
                              ? "rotate-180"
                              : ""
                          )}
                        />
                        <Badge variant="secondary">
                          <LuGitPullRequest className="size-3 mr-1" />
                          {material.storageUnitName ??
                            (material.methodType === "Make to Order"
                              ? t`WIP`
                              : t`Default Storage Unit`)}
                        </Badge>
                      </div>
                    </Td>
                    <Td>
                      {estimatedQuantity(material, parentIsSerial)}
                      {batchTotal && (
                        <div className="text-xs text-muted-foreground whitespace-nowrap">
                          <Trans>Batch</Trans>: {batchTotal.required}
                        </div>
                      )}
                    </Td>
                    <Td>
                      {actualQuantity(material, parentIsSerial)}
                      {batchTotal && (
                        <div className="text-xs text-muted-foreground whitespace-nowrap">
                          <Trans>Batch</Trans>: {batchTotal.issued}
                        </div>
                      )}
                    </Td>
                    <Td className="text-right">{issueButton(parent)}</Td>
                  </Tr>

                  {kitChildren.map((child, index) => (
                    <Tr
                      key={`kittedChild-${child.material.id}`}
                      className={cn(
                        index === kitChildren.length - 1
                          ? "border-b"
                          : index === 0
                            ? "border-t"
                            : "",
                        fadedIfUnrelated(child)
                      )}
                    >
                      <Td className="pl-10 max-w-[20vw]">
                        <HStack spacing={2} className="justify-between min-w-0">
                          <VStack spacing={0} className="min-w-0">
                            <span className="font-semibold truncate max-w-full">
                              {getItemReadableId(
                                items,
                                child.material.itemId ?? ""
                              )}
                            </span>
                            <span className="text-muted-foreground text-xs truncate max-w-full">
                              {child.material.description}
                            </span>
                            <PickedBreakdown
                              materialItemId={child.material.itemId}
                              pickedByItem={child.material.pickedByItem}
                            />
                          </VStack>
                          <TrackingBadge material={child.material} />
                          <PickedBadge
                            quantityPicked={child.material.quantityPicked}
                            quantityToPick={child.material.quantityToPick}
                          />
                        </HStack>
                      </Td>
                      <Td className="lg:table-cell hidden">
                        {methodBadge(child.material)}
                      </Td>
                      <Td>
                        {estimatedQuantity(child.material, parentIsSerial)}
                      </Td>
                      <Td>{actualQuantity(child.material, parentIsSerial)}</Td>
                      <Td className="text-right">{issueButton(child)}</Td>
                    </Tr>
                  ))}
                </Fragment>
              );
            })
          )}
        </Tbody>
      </Table>
    </div>
  );
}

function MaterialsList({ groups, parentIsSerial, onIssue }: LayoutProps) {
  const { t } = useLingui();
  const [items] = useItems();

  const renderRow = (row: MaterialRow) => {
    const { material, batchTotal } = row;
    return (
      <li
        key={`material-row-${material.id}`}
        className={cn(
          "flex items-center gap-3 px-4 py-3",
          row.isKitChild && "pl-8",
          !row.isRelatedToOperation && "opacity-50"
        )}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate font-semibold">
              {getItemReadableId(items, material.itemId ?? "")}
            </span>
            <span className="flex shrink-0 items-center gap-1 text-sm tabular-nums text-foreground font-medium">
              {actualQuantity(material, parentIsSerial)}
              <span aria-hidden>/</span>
              {estimatedQuantity(material, parentIsSerial)}
            </span>
          </div>
          {material.description ? (
            <span className="truncate text-sm text-muted-foreground">
              {material.description}
            </span>
          ) : null}
          <div className="flex flex-wrap items-center gap-1">
            <TrackingBadge material={material} />
            <ExpiredConsumedBadge material={material} />
            <PickedBadge
              quantityPicked={material.quantityPicked}
              quantityToPick={material.quantityToPick}
            />
          </div>
          <PickedBreakdown
            materialItemId={material.itemId}
            pickedByItem={material.pickedByItem}
          />
          {batchTotal ? (
            <span className="text-xs text-muted-foreground">
              <Trans>Batch</Trans>: {batchTotal.issued} / {batchTotal.required}
            </span>
          ) : null}
        </div>
        {/* A fixed slot, so the quantities line up. */}
        <div className="flex min-w-28 shrink-0 justify-end">
          {row.issue === "scan" && row.isKitChild ? (
            <IconButton
              aria-label={t`Issue Material`}
              variant="secondary"
              size="lg"
              icon={<LuQrCode />}
              onClick={() => onIssue(material)}
            />
          ) : row.issue ? (
            <Button
              size="lg"
              className="shrink-0"
              variant={row.isPrimaryIssue ? "primary" : "secondary"}
              leftIcon={
                row.issue === "scan" ? <LuQrCode /> : <LuGitBranchPlus />
              }
              onClick={() => onIssue(material)}
            >
              <Trans>Issue</Trans>
            </Button>
          ) : null}
        </div>
      </li>
    );
  };

  return (
    <ul className="-mx-4 w-[calc(100%+2rem)] divide-y divide-border border-y bg-card">
      {groups.length === 0 ? (
        <li className="py-8 text-center text-muted-foreground">
          <Trans>No materials</Trans>
        </li>
      ) : (
        groups.flatMap(({ parent, kitChildren }) => [
          renderRow(parent),
          ...kitChildren.map(renderRow)
        ])
      )}
    </ul>
  );
}
