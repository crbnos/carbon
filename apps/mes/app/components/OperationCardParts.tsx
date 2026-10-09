// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Badge, Heading, HStack } from "@carbon/react";
import { formatDurationMilliseconds } from "@carbon/utils";
import { Trans } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { LuTimer } from "react-icons/lu";
import { getPrivateUrl } from "~/utils/path";
import EmployeeAvatar from "./EmployeeAvatar";

/*
 * Parts shared by the operation cards: the schedule board's ItemCard and the
 * Assigned / Active list's OperationsList.
 */

/** Phones: the item thumbnail at the start of the card header. */
export function PhoneThumbnail({ path, alt }: { path: string; alt: string }) {
  return (
    <img
      src={getPrivateUrl(path)}
      alt={alt}
      className="hidden max-md:block size-10 shrink-0 rounded-md object-cover"
    />
  );
}

/** The quantity at the header's end; phones caption it "Quantity". */
export function QuantityStat({
  children,
  className
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="flex flex-col items-end">
      <Heading size="h4" className={className}>
        {children}
      </Heading>
      <span className="text-xs text-muted-foreground md:hidden">
        <Trans>Quantity</Trans>
      </span>
    </div>
  );
}

/** The remaining time; phones use the short form ("2d 4h"). */
export function OperationDuration({ value }: { value: number }) {
  return (
    <HStack className="justify-start space-x-2">
      <LuTimer className="text-muted-foreground" />
      <span className="text-sm max-md:hidden">
        {formatDurationMilliseconds(value)}
      </span>
      <span className="text-sm md:hidden">
        {formatDurationMilliseconds(value, { style: "short" })}
      </span>
    </HStack>
  );
}

export function AssigneeTags({
  assignee,
  tags
}: {
  assignee?: string | null;
  tags?: string[] | null;
}) {
  return (
    <>
      {assignee && <EmployeeAvatar size="xs" employeeId={assignee} />}
      {tags?.map((tag) => (
        <Badge
          key={tag}
          variant="secondary"
          className="border dark:border-none dark:shadow-button-base"
        >
          {tag}
        </Badge>
      ))}
    </>
  );
}
