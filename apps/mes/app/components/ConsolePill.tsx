// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

"use client";

import { useRevalidator } from "@carbon/query";
import { Avatar } from "@carbon/react";
import { useState } from "react";
import { LuChevronDown } from "react-icons/lu";
import type { PinnedInUser } from "~/types";
import { PinInOverlay } from "./PinInOverlay";

export function ConsolePill({
  user,
  companyId,
  locationEmployeeIds,
  sessionUserId
}: {
  user: PinnedInUser;
  companyId: string;
  locationEmployeeIds: string[];
  sessionUserId: string;
}) {
  const [open, setOpen] = useState(false);
  const revalidator = useRevalidator();

  const handleDismiss = () => {
    setOpen(false);
    // Revalidate the layout to pick up cookie changes (pin-in/pin-out)
    revalidator.revalidate();
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed top-3 left-1/2 -translate-x-1/2 z-40 max-md:top-auto max-md:left-4 max-md:translate-x-0 max-md:bottom-[calc(var(--mes-bottom-bar-h,var(--mes-tab-bar-h))+8px)] flex items-center gap-2 rounded-full border bg-card/90 backdrop-blur-md px-3 py-1.5 shadow-lg transition-[box-shadow,transform] duration-200 hover:shadow-xl active:scale-[0.98] select-none"
      >
        <Avatar size="xs" name={user.name} src={user.avatarUrl ?? undefined} />
        <span className="text-xs font-medium max-w-[130px] truncate">
          {user.name}
        </span>
        <LuChevronDown className="h-3 w-3 text-muted-foreground" />
      </button>

      {open && (
        <PinInOverlay
          companyId={companyId}
          locationEmployeeIds={locationEmployeeIds}
          sessionUserId={sessionUserId}
          hasPinnedUser={!!user}
          dismissable
          onDismiss={handleDismiss}
        />
      )}
    </>
  );
}
