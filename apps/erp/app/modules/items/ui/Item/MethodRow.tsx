// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Badge,
  HStack,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useViewport,
  VStack
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { LuExternalLink, LuSquareFunction } from "react-icons/lu";
import { Link } from "react-router";
import {
  ItemLifecycleBadge,
  MethodIcon,
  MethodItemTypeIcon,
  SourcingTypeIcon,
  TimeTypeIcon,
  TrackingTypeIcon
} from "~/components";
import { SupplierProcessPreview } from "~/components/Form/SupplierProcess";
import type { MethodItemType } from "~/modules/shared";
import { getLinkToItemDetails } from "./ItemForm";

/*
 * The rows of every Bill of Material and Bill of Process — item methods,
 * quote lines and jobs build their rows from these, so the six editors look
 * and behave the same. On phones the icon badges, whose meaning lives in a
 * hover tooltip, show their label as text instead.
 */

function MethodTypeLabel({ type }: { type: string }) {
  return type === "Purchase to Order" ? (
    <Trans>Purchase to Order</Trans>
  ) : type === "Pull from Inventory" ? (
    <Trans>Pull from Inventory</Trans>
  ) : (
    <Trans>Make to Order</Trans>
  );
}

function ItemTypeLabel({ type }: { type: string }) {
  return type === "Consumable" ? (
    <Trans>Consumable</Trans>
  ) : type === "Material" ? (
    <Trans>Material</Trans>
  ) : (
    <Trans>Part</Trans>
  );
}

function TrackingLabel({ type }: { type: string }) {
  return type === "Serial" ? (
    <Trans>Serial Tracking</Trans>
  ) : (
    <Trans>Batch Tracking</Trans>
  );
}

/** An icon badge with its label in a tooltip; on phones, icon and label. */
function LabelledIcon({ icon, label }: { icon: ReactNode; label: ReactNode }) {
  const { isPhone } = useViewport();
  if (isPhone) {
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap [&_svg]:size-3.5">
        {icon}
        {label}
      </span>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger>
        <Badge variant="secondary">{icon}</Badge>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function MaterialRowTitle({
  readableId,
  description,
  itemId,
  itemType,
  supersessionMode,
  hasRules
}: {
  readableId?: string | null;
  description?: string | null;
  itemId?: string | null;
  itemType?: string | null;
  supersessionMode?: Parameters<typeof ItemLifecycleBadge>[0]["mode"];
  hasRules?: boolean;
}) {
  return (
    <VStack spacing={0} className="py-1 cursor-pointer max-md:py-0">
      <div className="flex w-full min-w-0 items-center gap-2 group">
        <h3 className="font-semibold min-w-0 truncate">{readableId ?? ""}</h3>
        <ItemLifecycleBadge mode={supersessionMode} />
        {hasRules && (
          <LuSquareFunction className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
        )}
        {itemId && itemType && (
          <Link
            to={getLinkToItemDetails(itemType as MethodItemType, itemId)}
            onClick={(e) => e.stopPropagation()}
            className="max-md:hit-area shrink-0"
          >
            <LuExternalLink className="h-4 w-4 md:opacity-0 group-hover:opacity-100" />
          </Link>
        )}
      </div>
      {description && (
        <span className="text-xs text-muted-foreground max-md:w-full max-md:truncate max-md:text-sm">
          {description}{" "}
        </span>
      )}
    </VStack>
  );
}

export function MaterialRowDetails({
  trackingType,
  methodType,
  isKit,
  sourcingType,
  quantity,
  itemType
}: {
  /** "Batch" or "Serial"; anything else shows nothing. */
  trackingType?: string | null;
  methodType: string;
  isKit?: boolean | null;
  /** Only for items that are bought and made. */
  sourcingType?: string | null;
  quantity: ReactNode;
  itemType: string;
}) {
  const { isPhone } = useViewport();
  const tracking =
    trackingType === "Batch" || trackingType === "Serial" ? (
      <LabelledIcon
        icon={<TrackingTypeIcon type={trackingType} />}
        label={<TrackingLabel type={trackingType} />}
      />
    ) : null;
  const method = (
    <LabelledIcon
      icon={<MethodIcon type={methodType} isKit={isKit ?? undefined} />}
      label={<MethodTypeLabel type={methodType} />}
    />
  );
  const sourcing = sourcingType ? (
    <LabelledIcon
      icon={<SourcingTypeIcon type={sourcingType} />}
      label={sourcingType}
    />
  ) : null;
  const type = (
    <LabelledIcon
      icon={<MethodItemTypeIcon type={itemType} />}
      label={<ItemTypeLabel type={itemType} />}
    />
  );

  if (isPhone) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
        <span className="font-medium text-foreground tabular-nums">
          <Trans>Qty {quantity}</Trans>
        </span>
        {method}
        {tracking}
        {sourcing}
        {type}
      </div>
    );
  }

  return (
    <HStack spacing={2}>
      {tracking}
      {method}
      {sourcing}
      <Badge variant="secondary">{quantity}</Badge>
      {type}
    </HStack>
  );
}

type OperationTimes = {
  operationType?: string | null;
  setupTime?: number | null;
  setupUnit?: string | null;
  laborTime?: number | null;
  laborUnit?: string | null;
  machineTime?: number | null;
  machineUnit?: string | null;
};

export function OperationRowTitle({
  description,
  operationType,
  processId,
  supplierProcessId,
  badges
}: {
  description?: string | null;
  operationType?: string | null;
  processId?: string | null;
  supplierProcessId?: string | null;
  /** Extra chips beside the name (a job's Rework or batch). */
  badges?: ReactNode;
}) {
  return (
    <VStack spacing={0}>
      <HStack spacing={2} className="w-full min-w-0 max-md:flex-wrap">
        <h3 className="font-semibold min-w-0 truncate cursor-pointer max-md:whitespace-normal max-md:line-clamp-2">
          {description}
        </h3>
        {badges}
      </HStack>
      {operationType === "Outside Processing" && (
        <SupplierProcessPreview
          processId={processId ?? ""}
          supplierProcessId={supplierProcessId ?? undefined}
        />
      )}
    </VStack>
  );
}

export function OperationRowDetails({
  operation
}: {
  operation: OperationTimes;
}) {
  const { isPhone } = useViewport();
  if (operation.operationType === "Outside Processing") {
    return (
      <HStack spacing={1}>
        <Badge>
          <Trans>Outside Processing</Trans>
        </Badge>
      </HStack>
    );
  }

  const times = (
    [
      ["Setup", operation.setupTime, operation.setupUnit],
      ["Labor", operation.laborTime, operation.laborUnit],
      ["Machine", operation.machineTime, operation.machineUnit]
    ] as const
  ).filter(([, time]) => (time ?? 0) > 0);

  if (isPhone) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
        {times.map(([type, time, unit]) => (
          <span key={type} className="inline-flex items-center gap-1">
            <TimeTypeIcon type={type} className="size-3.5" />
            {time} {unit}
          </span>
        ))}
      </div>
    );
  }

  return (
    <HStack spacing={1}>
      {times.map(([type, time, unit]) => (
        <Badge key={type} variant="secondary">
          <TimeTypeIcon type={type} className="h-3 w-3 mr-1" />
          {time} {unit}
        </Badge>
      ))}
    </HStack>
  );
}
