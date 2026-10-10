// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useAccountSettings } from "@carbon/account";
import type { Company } from "@carbon/auth";
import { CONTROLLED_ENVIRONMENT } from "@carbon/auth";
import {
  Avatar,
  BottomSheet,
  BottomSheetBack,
  BottomSheetBody,
  BottomSheetContent,
  BottomSheetHeader,
  BottomSheetTitle,
  cn,
  ItarDisclosure,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  NavRailItem,
  Switch,
  useDisclosure
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { MouseEvent, ReactNode } from "react";
import { createContext, useContext, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  LuBuilding,
  LuCheck,
  LuChevronRight,
  LuLogOut,
  LuMapPin,
  LuMonitor,
  LuMoon,
  LuShieldCheck,
  LuSun,
  LuUser,
  LuUsers
} from "react-icons/lu";
import { Form, useLocation } from "react-router";
import type { Location } from "~/services/types";
import type { PinnedInUser } from "~/types";
import { path } from "~/utils/path";
import { useUserNav } from "./UserNav";

type Screen =
  | { id: "root" }
  | { id: "company" }
  | { id: "location" }
  /** A tool's own page, e.g. Add Inventory. */
  | { id: "tool"; tool: string; title: ReactNode };

type MorePageContextValue = {
  activeTool: string | null;
  slot: HTMLElement | null;
  open: (tool: string, title: ReactNode) => void;
  /** Back to the More list. */
  back: () => void;
  /** The tool's work is done: close the sheet. */
  done: () => void;
};

const MorePageContext = createContext<MorePageContextValue | null>(null);

/**
 * Set inside the phone More sheet: a tool opens its form as a page of the
 * sheet (‹ Back to the list) instead of a modal or popover of its own.
 */
export function useMorePage() {
  return useContext(MorePageContext);
}

/**
 * A tool's form surface: a page of the phone More sheet, or a modal
 * elsewhere. `open`, `close` (Cancel) and `done` (after success) work the same
 * for both, so a tool never checks where it is.
 */
export function useToolSurface(tool: string, title: string) {
  const page = useMorePage();
  const modal = useDisclosure();
  return {
    tool,
    title,
    inSheet: page !== null,
    isOpen: page ? page.activeTool === tool : modal.isOpen,
    open: () => (page ? page.open(tool, title) : modal.onOpen()),
    close: () => (page ? page.back() : modal.onClose()),
    done: () => (page ? page.done() : modal.onClose())
  };
}

/**
 * Renders a tool's form on its surface. `wrap` puts the whole form inside a
 * form element (ValidatedForm, fetcher.Form) so its footer can submit it.
 */
export function ToolSurface({
  surface,
  description,
  body,
  footer,
  wrap = (children) => children
}: {
  surface: ReturnType<typeof useToolSurface>;
  description?: ReactNode;
  body: ReactNode;
  footer: ReactNode;
  wrap?: (children: ReactNode) => ReactNode;
}) {
  if (surface.inSheet) {
    return (
      <MorePage tool={surface.tool}>
        {wrap(
          <div className="flex flex-col gap-4">
            {description ? (
              <p className="text-sm text-muted-foreground">{description}</p>
            ) : null}
            {body}
            <div className="flex gap-2 [&>*]:flex-1">{footer}</div>
          </div>
        )}
      </MorePage>
    );
  }
  if (!surface.isOpen) return null;
  return (
    <Modal open onOpenChange={(open) => !open && surface.close()}>
      <ModalContent>
        {wrap(
          <>
            <ModalHeader>
              <ModalTitle>{surface.title}</ModalTitle>
              {description ? (
                <ModalDescription>{description}</ModalDescription>
              ) : null}
            </ModalHeader>
            <ModalBody>{body}</ModalBody>
            <ModalFooter>{footer}</ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}

/** A tool's page content; rendered into the sheet while its page shows. */
export function MorePage({
  tool,
  children
}: {
  tool: string;
  children: ReactNode;
}) {
  const page = useMorePage();
  if (!page?.slot || page.activeTool !== tool) return null;
  return createPortal(children, page.slot);
}

/**
 * Phones: the More tab's sheet. Everything the rail holds besides the queues
 * (those are behind the app bar title): the time card, inventory adjustments,
 * tools, and the user menu. Company, Location and each tool's form open as
 * pages in this sheet, with ‹ Back to the list.
 */
export function MoreSheet({
  open,
  onOpenChange,
  header,
  children,
  company,
  companies,
  consoleEnabled,
  consoleMode,
  location,
  locations,
  pinnedInUser
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Above everything, e.g. the company link back to the ERP. */
  header?: ReactNode;
  /** The rail's tools, as rail items. */
  children?: ReactNode;
  company: Company;
  companies: Company[];
  consoleEnabled?: boolean;
  consoleMode: boolean;
  location: string;
  locations: Location[];
  pinnedInUser: PinnedInUser | null;
}) {
  const { t } = useLingui();
  const openAccountSettings = useAccountSettings((s) => s.open);
  const { pathname } = useLocation();
  const [screen, setScreen] = useState<Screen>({ id: "root" });
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const toRoot = () => setScreen({ id: "root" });
  const user = useUserNav({ consoleMode, location, pinnedInUser });
  const { stationName } = user;

  useEffect(() => {
    if (!open) setScreen({ id: "root" });
  }, [open]);

  // Links, redirects and company switches all land here.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs per navigation
  useEffect(() => {
    onOpenChange(false);
  }, [pathname]);

  // A tap on a link closes the sheet, also on the current page.
  const closeOnLink = (event: MouseEvent<HTMLElement>) => {
    if ((event.target as Element).closest("a")) onOpenChange(false);
  };

  const modeOptions = [
    { value: "light", label: t`Light` },
    { value: "dark", label: t`Dark` },
    { value: "system", label: t`System` }
  ];

  const title =
    screen.id === "company" ? (
      <Trans>Company</Trans>
    ) : screen.id === "location" ? (
      <Trans>Location</Trans>
    ) : screen.id === "tool" ? (
      screen.title
    ) : (
      <Trans>More</Trans>
    );

  const page: MorePageContextValue = {
    activeTool: screen.id === "tool" ? screen.tool : null,
    slot,
    open: (tool, title) => setScreen({ id: "tool", tool, title }),
    back: toRoot,
    done: () => onOpenChange(false)
  };

  return (
    <>
      <BottomSheet open={open} onOpenChange={onOpenChange}>
        <BottomSheetContent>
          <BottomSheetHeader>
            {screen.id !== "root" && <BottomSheetBack onClick={toRoot} />}
            <BottomSheetTitle>{title}</BottomSheetTitle>
          </BottomSheetHeader>
          <BottomSheetBody className="max-md:px-2">
            {/* Rail items read their expanded layout from this group. */}
            <MorePageContext.Provider value={page}>
              <div
                data-state="expanded"
                onClick={closeOnLink}
                className="group flex flex-col gap-1"
              >
                {/* Kept mounted under a page, so a tool's form keeps its state
                  and its fetcher while its page shows. */}
                <div
                  className={cn(
                    "flex flex-col gap-1",
                    screen.id !== "root" && "hidden"
                  )}
                >
                  <div className="flex items-center gap-3 px-2 pb-2">
                    <Avatar
                      size="sm"
                      src={user.displayAvatar ?? undefined}
                      name={user.displayName}
                    />
                    <span className="min-w-0 truncate text-sm text-muted-foreground">
                      {user.showingOperator ? (
                        <Trans>Station: {stationName}</Trans>
                      ) : (
                        <Trans>Signed in as {stationName}</Trans>
                      )}
                    </span>
                  </div>
                  {header}
                  {children}
                  <Divider />
                  {user.showingOperator ? (
                    <NavRailItem
                      icon={<LuUsers />}
                      label={t`Switch Operator`}
                      onClick={() => {
                        user.switchOperator();
                        onOpenChange(false);
                      }}
                    />
                  ) : (
                    <>
                      <NavRailItem
                        icon={<LuUser />}
                        label={t`Account Settings`}
                        onClick={() => {
                          onOpenChange(false);
                          openAccountSettings();
                        }}
                      />
                      {companies.length > 1 && (
                        <NavRailItem
                          icon={<LuBuilding />}
                          label={t`Company`}
                          onClick={() => setScreen({ id: "company" })}
                          trailing={<Drill detail={company.name} />}
                        />
                      )}
                      {locations.length > 1 && (
                        <NavRailItem
                          icon={<LuMapPin />}
                          label={t`Location`}
                          onClick={() => setScreen({ id: "location" })}
                          trailing={
                            <Drill
                              detail={
                                locations.find(
                                  (l) => l.id === user.optimisticLocation
                                )?.name
                              }
                            />
                          }
                        />
                      )}
                    </>
                  )}
                  <div className="flex h-10 items-center gap-4 px-2 text-sm text-foreground/70">
                    <span className="flex size-6 shrink-0 items-center justify-center [&>svg]:size-4">
                      {user.mode === "dark" ? <LuMoon /> : <LuSun />}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium">
                      <Trans>Appearance</Trans>
                    </span>
                    <div
                      role="radiogroup"
                      aria-label={t`Appearance`}
                      className="flex shrink-0 rounded-lg bg-muted p-0.5"
                    >
                      {modeOptions.map((option) => {
                        const selected = user.modePreference === option.value;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            onClick={() => user.onModeChange(option.value)}
                            className={cn(
                              "hit-area flex h-8 min-w-11 items-center justify-center rounded-md px-2 text-sm text-muted-foreground",
                              selected &&
                                "bg-background text-foreground shadow-button-base"
                            )}
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  {!user.isOperatorPinnedIn && (
                    <>
                      {consoleEnabled && (
                        <label className="flex h-10 items-center gap-4 px-2 text-sm text-foreground/70">
                          <span className="flex size-6 shrink-0 items-center justify-center [&>svg]:size-4">
                            <LuMonitor />
                          </span>
                          <span className="min-w-0 flex-1 truncate font-medium">
                            <Trans>Console Mode</Trans>
                          </span>
                          <Switch
                            checked={consoleMode}
                            onCheckedChange={user.toggleConsoleMode}
                          />
                        </label>
                      )}
                      {CONTROLLED_ENVIRONMENT && (
                        <NavRailItem
                          icon={<LuShieldCheck />}
                          label={t`About`}
                          onClick={user.itarDisclosure.onOpen}
                        />
                      )}
                      <Form method="post" action={path.to.logout}>
                        <NavRailItem
                          type="submit"
                          icon={<LuLogOut />}
                          label={t`Sign Out`}
                        />
                      </Form>
                    </>
                  )}
                </div>
                {screen.id === "tool" && (
                  <div ref={setSlot} className="flex flex-col gap-4 px-2" />
                )}
                {screen.id === "company" &&
                  companies.map((c) => {
                    const logo =
                      user.mode === "dark" ? c.logoDarkIcon : c.logoLightIcon;
                    const isCurrent = c.companyId === company.companyId;
                    return (
                      <NavRailItem
                        key={c.companyId}
                        icon={
                          <Avatar
                            size="xs"
                            name={c.name ?? undefined}
                            src={logo ?? undefined}
                          />
                        }
                        label={c.name ?? ""}
                        isActive={isCurrent}
                        onClick={() => {
                          if (!isCurrent) user.switchCompany(c.companyId!);
                          onOpenChange(false);
                        }}
                        trailing={isCurrent ? <Check /> : undefined}
                      />
                    );
                  })}
                {screen.id === "location" &&
                  locations.map((l) => {
                    const isCurrent = l.id === user.optimisticLocation;
                    return (
                      <NavRailItem
                        key={l.id}
                        icon={<LuMapPin />}
                        label={l.name}
                        isActive={isCurrent}
                        onClick={() => {
                          if (!isCurrent) user.updateLocation(l.id);
                          onOpenChange(false);
                        }}
                        trailing={isCurrent ? <Check /> : undefined}
                      />
                    );
                  })}
              </div>
            </MorePageContext.Provider>
          </BottomSheetBody>
        </BottomSheetContent>
      </BottomSheet>
      {CONTROLLED_ENVIRONMENT && (
        <ItarDisclosure disclosure={user.itarDisclosure} />
      )}
    </>
  );
}

function Divider() {
  return <hr className="mx-2 my-1 h-px border-0 bg-border" />;
}

function Drill({ detail }: { detail?: ReactNode }) {
  return (
    <span className="flex min-w-0 items-center gap-1 text-muted-foreground">
      {detail ? (
        <span className="max-w-36 truncate text-sm">{detail}</span>
      ) : null}
      <LuChevronRight className="size-4 shrink-0" />
    </span>
  );
}

function Check() {
  return <LuCheck className="size-4 text-primary" />;
}
