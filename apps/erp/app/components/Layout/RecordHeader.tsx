// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  ActionPresentationProvider,
  BottomSheet,
  BottomSheetBody,
  BottomSheetContent,
  BottomSheetHeader,
  BottomSheetTitle,
  Copy,
  cn,
  copyToClipboard,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Heading,
  HStack,
  IconButton,
  toast,
  useCompact
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useState } from "react";
import {
  LuCopy,
  LuEllipsis,
  LuEllipsisVertical,
  LuPanelLeft,
  LuPanelRight
} from "react-icons/lu";
import { Link } from "react-router";
import { create } from "zustand";
import {
  AppBarActions,
  BottomBar,
  useCompactCssVar
} from "./Mobile/ChromeSlots";
import { createPortalSlot } from "./Mobile/slots";

/** Where record actions go on phones: the bottom bar's cells, the ⋯ sheet. */
const primarySlot = createPortalSlot();
const secondarySlot = createPortalSlot();
const overflowSlot = createPortalSlot();
/** A card form's hero: DocumentHeader fills it, the page places it. */
export const recordHeroSlot = createPortalSlot();

/** The ⋯ action sheet; one record frame shows at a time, like its slot. */
const useOverflowSheet = create<{
  open: boolean;
  setOpen: (open: boolean) => void;
}>()((set) => ({ open: false, setOpen: (open) => set({ open }) }));
const closeOverflow = () => useOverflowSheet.getState().setOpen(false);

const presentations = {
  primary: { kind: "bar", emphasis: "primary" },
  secondary: { kind: "bar", emphasis: "secondary" },
  overflow: { kind: "row", onSelect: closeOverflow }
} as const;
const slots = {
  primary: primarySlot,
  secondary: secondarySlot,
  overflow: overflowSlot
};

/**
 * A record header action. Desktop renders it in place; phones move it to
 * the bottom bar (`primary` filled, `secondary` outline) or the ⋯ sheet
 * (`overflow`), and its Button renders to match (see ActionPresentation).
 */
export function RecordAction({
  slot,
  children
}: {
  slot: "primary" | "secondary" | "overflow";
  children: ReactNode;
}) {
  const isCompact = useCompact();
  if (!isCompact) return <>{children}</>;
  const { Fill } = slots[slot];
  return (
    <Fill>
      <ActionPresentationProvider value={presentations[slot]}>
        {children}
      </ActionPresentationProvider>
    </Fill>
  );
}

/**
 * Phones: the record's name, subtitle and status under the app bar. Kept
 * mounted (hidden) when empty, so --header-height still resolves (to 0):
 * record frames size their body from it, and here the hero takes the place
 * of the desktop header.
 */
export function RecordHero({
  title,
  subtitle,
  status,
  bleed = false
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  status?: ReactNode;
  /** The page pads its content by 16pt: pull the hero out to the edges. */
  bleed?: boolean;
}) {
  const isCompact = useCompact();
  const [element, setElement] = useState<HTMLElement | null>(null);
  useCompactCssVar("--header-height", element);
  useCompactCssVar("--hero-height", element);
  if (!isCompact) return null;

  const hasHero = Boolean(title || subtitle || status);
  return (
    <div
      ref={setElement}
      className={cn(
        "flex shrink-0 flex-col self-stretch",
        hasHero ? "gap-1.5 border-b border-border bg-card px-4 py-3" : "hidden",
        bleed && "-mx-4 -mt-4"
      )}
    >
      {title ? (
        <h1 className="min-w-0 truncate text-[22px] font-semibold leading-tight text-foreground">
          {title}
        </h1>
      ) : null}
      {subtitle ? (
        <p className="min-w-0 truncate text-[13px] text-muted-foreground">
          {subtitle}
        </p>
      ) : null}
      {status ? (
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 empty:hidden">
          {status}
        </div>
      ) : null}
    </div>
  );
}

/** Where a card form's hero shows on phones (see DocumentHeader). */
export function RecordHeroTarget({ bleed = false }: { bleed?: boolean }) {
  const isCompact = useCompact();
  if (!isCompact) return null;
  return (
    <recordHeroSlot.Target
      className={cn("flex flex-col self-stretch", bleed && "-mx-4 -mt-4")}
    />
  );
}

const cellClassName =
  "flex min-w-0 flex-1 empty:hidden [&>*]:w-full [&>*]:min-w-0";

/**
 * Phones: the record's app-bar ⋯ (Copy ID and its menu) and the bottom
 * action bar with the ⋯ sheet that its RecordActions fill. Renders nothing
 * at md and above.
 */
export function RecordPhoneChrome({
  menu,
  copyValue
}: {
  menu?: ReactNode;
  copyValue?: string;
}) {
  const { t } = useLingui();
  const isCompact = useCompact();
  const hasPrimary = primarySlot.useFilled();
  const hasSecondary = secondarySlot.useFilled();
  const hasOverflow = overflowSlot.useFilled();
  const { open, setOpen } = useOverflowSheet();
  if (!isCompact) return null;

  const onCopy = async () => {
    if (copyValue && (await copyToClipboard(copyValue))) {
      toast.success(t`Copied to clipboard`);
    }
  };

  return (
    <>
      {menu || copyValue ? (
        <AppBarActions>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                className="order-last"
                aria-label={t`More options`}
                icon={<LuEllipsis />}
                variant="ghost"
                size="lg"
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {copyValue ? (
                <DropdownMenuItem onClick={onCopy}>
                  <DropdownMenuIcon icon={<LuCopy />} />
                  <Trans>Copy ID</Trans>
                </DropdownMenuItem>
              ) : null}
              {menu}
            </DropdownMenuContent>
          </DropdownMenu>
        </AppBarActions>
      ) : null}

      {hasPrimary || hasSecondary || hasOverflow ? (
        <BottomBar>
          <div className="flex items-center gap-2 border-t border-border bg-card px-4 pt-2 pb-safe-4 [&>*]:min-w-0">
            <primarySlot.Target className={cellClassName} />
            <secondarySlot.Target className={cellClassName} />
            {hasOverflow ? (
              <IconButton
                aria-label={t`More actions`}
                icon={<LuEllipsis />}
                variant="secondary"
                size="lg"
                className="ml-auto shrink-0"
                onClick={() => setOpen(true)}
              />
            ) : null}
          </div>
        </BottomBar>
      ) : null}

      <BottomSheet open={open} onOpenChange={setOpen}>
        <BottomSheetContent>
          <BottomSheetHeader>
            <BottomSheetTitle>
              <Trans>Actions</Trans>
            </BottomSheetTitle>
          </BottomSheetHeader>
          <BottomSheetBody>
            <overflowSlot.Target className="flex flex-col [&>*]:w-full" />
          </BottomSheetBody>
        </BottomSheetContent>
      </BottomSheet>
    </>
  );
}

type RecordHeaderProps = {
  /** The record's name. Phones show it in the app bar (the breadcrumb). */
  title: ReactNode;
  /**
   * Phones: render `title` in the hero instead. For a title the user edits
   * (a name input): it renders once, in the desktop row or the hero.
   */
  titleInHero?: boolean;
  /** Links the desktop title (usually the record's details page). */
  titleTo?: string;
  /** Desktop <Copy> and the phone app bar's "Copy ID". */
  copyValue?: string;
  /** The ⋯ menu items: desktop beside the title, phones in the app bar. */
  menu?: ReactNode;
  /** Status badges: desktop after the ⋯, phones in the hero. */
  status?: ReactNode;
  /** Phones: a line under the hero title. */
  subtitle?: ReactNode;
  onToggleExplorer?: () => void;
  onToggleProperties?: () => void;
  /** Desktop: a node before the actions (an item's sub-route tabs). */
  aside?: ReactNode;
  /** The record's actions, each in a RecordAction. */
  actions?: ReactNode;
};

/**
 * A record page's header: the desktop row, and on phones a hero, the
 * app-bar ⋯ and a bottom action bar, all from one set of props. The desktop
 * row stays mounted (hidden) on phones, for its modals and portalled actions.
 */
export function RecordHeader({
  title,
  titleInHero = false,
  titleTo,
  copyValue,
  menu,
  status,
  subtitle,
  onToggleExplorer,
  onToggleProperties,
  aside,
  actions
}: RecordHeaderProps) {
  const { t } = useLingui();
  const isCompact = useCompact();
  // An editable title is a control (a name input), not a heading.
  const heading = titleInHero ? (
    title
  ) : (
    <Heading size="h4" className="flex items-center gap-2">
      {title}
    </Heading>
  );

  return (
    <>
      <RecordHero
        title={isCompact && titleInHero ? title : undefined}
        subtitle={subtitle}
        status={status}
      />
      <RecordPhoneChrome menu={menu} copyValue={copyValue} />
      <div
        className={cn(
          "flex flex-shrink-0 items-center justify-between gap-x-4 py-2 bg-card border-b border-border h-[var(--header-height)] overflow-x-auto scrollbar-hide compact:hidden",
          onToggleExplorer ? "pl-2" : "pl-4",
          onToggleProperties ? "pr-2" : "pr-4"
        )}
      >
        <HStack className="min-w-0">
          {onToggleExplorer ? (
            <IconButton
              aria-label={t`Toggle Explorer`}
              icon={<LuPanelLeft />}
              onClick={onToggleExplorer}
              variant="ghost"
            />
          ) : null}
          {isCompact && titleInHero ? null : titleTo ? (
            <Link to={titleTo}>{heading}</Link>
          ) : (
            heading
          )}
          {copyValue ? <Copy text={copyValue} /> : null}
          {menu ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton
                  aria-label={t`More options`}
                  icon={<LuEllipsisVertical />}
                  variant="secondary"
                  size="sm"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent>{menu}</DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          {status}
        </HStack>
        <HStack>
          {aside}
          {actions}
          {onToggleProperties ? (
            <IconButton
              aria-label={t`Toggle Properties`}
              icon={<LuPanelRight />}
              onClick={onToggleProperties}
              variant="ghost"
            />
          ) : null}
        </HStack>
      </div>
    </>
  );
}
