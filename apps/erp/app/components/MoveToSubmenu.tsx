// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  IconButton,
  useViewport
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuEllipsisVertical, LuMoveRight } from "react-icons/lu";

export type MoveTarget = { id: string; title: string };

type MoveToProps = {
  /** The board's other columns, in board order. Called only on phones, so
   *  desktop renders never pay for it. */
  getTargets: () => MoveTarget[];
  /** The same move the board's drop handler makes. */
  onMove: (columnId: string) => void;
};

/**
 * "Move to" for a board card's ⋯ menu, on phones only: a phone shows one
 * column at a time, so dragging across columns is impractical and this makes
 * the drop's move reachable by tap. Renders nothing on desktop.
 */
export function MoveToSubmenu({ getTargets, onMove }: MoveToProps) {
  const { isPhone } = useViewport();
  if (!isPhone) return null;
  const targets = getTargets();
  if (targets.length === 0) return null;

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <DropdownMenuIcon icon={<LuMoveRight />} />
        <Trans>Move to</Trans>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        {targets.map((target) => (
          <DropdownMenuItem key={target.id} onClick={() => onMove(target.id)}>
            {target.title}
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/**
 * The same "Move to" for a card that has no ⋯ menu of its own: brings its own
 * trigger. Phones only; renders nothing on desktop.
 */
export function MoveToMenu({ getTargets, onMove }: MoveToProps) {
  const { t } = useLingui();
  const { isPhone } = useViewport();
  if (!isPhone) return null;
  const targets = getTargets();
  if (targets.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          aria-label={t`More options`}
          icon={<LuEllipsisVertical />}
          variant="ghost"
          size="sm"
          // Keeps a drag sensor on the card from taking the tap.
          onPointerDown={(e) => e.stopPropagation()}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>
          <Trans>Move to</Trans>
        </DropdownMenuLabel>
        {targets.map((target) => (
          <DropdownMenuItem key={target.id} onClick={() => onMove(target.id)}>
            <DropdownMenuIcon icon={<LuMoveRight />} />
            {target.title}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
