// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  ActionPresentationProvider,
  Copy,
  cn,
  copyToClipboard,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Heading,
  HStack,
  IconButton,
  toast,
  useViewport
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
  PhoneActionBar,
  useCompactCssVar
} from "./Mobile/ChromeSlots";
import { createPortalSlot } from "./Mobile/slots";

/**
 * Where record actions go on phones: the bottom bar's cells (an icon cell,
 * then the primary and secondary), and the app-bar ⋯.
 */
const iconSlot = createPortalSlot();
const primarySlot = createPortalSlot();
const secondarySlot = createPortalSlot();
const overflowSlot = createPortalSlot();
/** A card form's hero: DocumentHeader fills it, the page places it. */
export const recordHeroSlot = createPortalSlot();

/** The app-bar ⋯ menu; one record frame shows at a time, like its slot. */
const useOverflowSheet = create<{
  open: boolean;
  setOpen: (open: boolean) => void;
}>()((set) => ({ open: false, setOpen: (open) => set({ open }) }));
const closeOverflow = () => useOverflowSheet.getState().setOpen(false);

const presentations = {
  icon: { kind: "bar", emphasis: "secondary", iconOnly: true },
  primary: { kind: "bar", emphasis: "primary" },
  secondary: { kind: "bar", emphasis: "secondary" },
  overflow: { kind: "row", onSelect: closeOverflow }
} as const;
const slots = {
  icon: iconSlot,
  primary: primarySlot,
  secondary: secondarySlot,
  overflow: overflowSlot
};

/**
 * A record header action. Desktop renders it in place; phones move it to
 * the bottom bar (`icon` a square outline cell, `primary` filled, `secondary`
 * outline) or the app-bar ⋯ (`overflow`), and its Button renders to match
 * (see ActionPresentation).
 */
export function RecordAction({
  slot,
  children
}: {
  slot: "icon" | "primary" | "secondary" | "overflow";
  children: ReactNode;
}) {
  const { isPhone } = useViewport();
  if (!isPhone) return <>{children}</>;
  const { Fill } = slots[slot];
  const presentation = presentations[slot];
  return (
    <Fill>
      <ActionPresentationProvider
        value={
          presentation.kind === "bar"
            ? { ...presentation, overflow: renderOverflow }
            : presentation
        }
      >
        {children}
      </ActionPresentationProvider>
    </Fill>
  );
}

/** A bar action's extra buttons (a split button's items) as ⋯ menu rows. */
function renderOverflow(buttons: ReactNode) {
  return (
    <overflowSlot.Fill>
      <ActionPresentationProvider value={presentations.overflow}>
        {buttons}
      </ActionPresentationProvider>
    </overflowSlot.Fill>
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
  const { isPhone } = useViewport();
  const [element, setElement] = useState<HTMLElement | null>(null);
  useCompactCssVar("--header-height", element);
  useCompactCssVar("--hero-height", element);
  if (!isPhone) return null;

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
  const { isPhone } = useViewport();
  if (!isPhone) return null;
  return (
    <recordHeroSlot.Target
      className={cn("flex flex-col self-stretch", bleed && "-mx-4 -mt-4")}
    />
  );
}

const cellClassName =
  "flex min-w-0 flex-1 empty:hidden [&>*]:w-full [&>*]:min-w-0";

/**
 * Phones: the record's one ⋯, in the app bar (Copy ID, the header menu, then
 * the overflow actions), and the bottom action bar its
 * RecordActions fill. Renders nothing at md and above.
 */
export function RecordPhoneChrome({
  menu,
  copyValue
}: {
  menu?: ReactNode;
  copyValue?: string;
}) {
  const { t } = useLingui();
  const { isPhone } = useViewport();
  const hasIcon = iconSlot.useFilled();
  const hasPrimary = primarySlot.useFilled();
  const hasSecondary = secondarySlot.useFilled();
  const hasOverflow = overflowSlot.useFilled();
  const { open, setOpen } = useOverflowSheet();
  if (!isPhone) return null;

  const onCopy = async () => {
    if (copyValue && (await copyToClipboard(copyValue))) {
      toast.success(t`Copied to clipboard`);
    }
  };

  const hasMenu = Boolean(menu || copyValue || hasOverflow);

  return (
    <>
      {hasMenu ? (
        <AppBarActions>
          <DropdownMenu open={open} onOpenChange={setOpen}>
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
              {hasOverflow ? (
                <>
                  <DropdownMenuSeparator />
                  {/* Overflow actions render as menu rows here; choosing
                      one closes the menu (closeOverflow). */}
                  <overflowSlot.Target className="flex flex-col [&>*]:w-full" />
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </AppBarActions>
      ) : null}

      {hasIcon || hasPrimary || hasSecondary ? (
        <PhoneActionBar className="[&>*]:min-w-0">
          <iconSlot.Target className="flex shrink-0 empty:hidden" />
          <primarySlot.Target className={cellClassName} />
          <secondarySlot.Target className={cellClassName} />
        </PhoneActionBar>
      ) : null}
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
  const { isPhone } = useViewport();
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
        title={isPhone && titleInHero ? title : undefined}
        subtitle={subtitle}
        status={status}
      />
      <RecordPhoneChrome menu={menu} copyValue={copyValue} />
      <div
        className={cn(
          "flex flex-shrink-0 items-center justify-between gap-x-4 py-2 bg-card border-b border-border h-[var(--header-height)] overflow-x-auto scrollbar-hide max-md:hidden",
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
          {isPhone && titleInHero ? null : titleTo ? (
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
