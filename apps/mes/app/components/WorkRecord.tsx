// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  Heading,
  HStack,
  IconButton,
  Separator,
  SidebarTrigger,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { LuChevronLeft, LuEllipsisVertical } from "react-icons/lu";
import { Link } from "react-router";
import { Controls } from "~/components/JobOperation/components/Controls";
import { MesAppBar } from "~/components/MesAppBar";

/**
 * The job operation view's frame, for a record a technician works the same
 * way: maintenance dispatches and service jobs. A top bar with the back link
 * and the tabs, a strip with the record id and its facts, one scrolling pane
 * per tab, and the operation view's dock (`Controls`) on the right from `lg`
 * and along the bottom below it. The classes are the operation view's.
 */
export function WorkRecordShell({
  recordId,
  back,
  tabs,
  tab,
  onTabChange,
  chips,
  menu,
  dock,
  children
}: {
  recordId: string;
  back: { to: string; label: ReactNode };
  tabs: { value: string; label: ReactNode; disabled?: boolean }[];
  tab: string;
  onTabChange: (tab: string) => void;
  /** `WorkRecordChip`s, right of the record id. */
  chips: ReactNode;
  /**
   * The record's ⋮ menu items: beside the record id from md, in the app bar
   * on phones, as on the job operation view.
   */
  menu?: ReactNode;
  /** A `WorkRecordDock`, or null when there is nothing to do. */
  dock: ReactNode;
  /** One `WorkRecordPane` per tab. */
  children: ReactNode;
}) {
  const { t } = useLingui();
  const renderMenu = ({
    className,
    size,
    align
  }: {
    className?: string;
    size?: "lg";
    align: "start" | "end";
  }) =>
    menu ? (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton
            aria-label={t`More options`}
            variant="ghost"
            size={size}
            className={className}
            icon={<LuEllipsisVertical />}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align={align}>{menu}</DropdownMenuContent>
      </DropdownMenu>
    ) : null;

  return (
    <Tabs
      value={tab}
      onValueChange={onTabChange}
      className="grid h-svh md:h-[calc(100svh-1rem)] min-h-0 w-full min-w-0 bg-card grid-cols-[minmax(0,1fr)] grid-rows-[auto_auto_auto_minmax(0,1fr)_auto] [grid-template-areas:'header'_'context'_'sep'_'main'_'dock'] lg:grid-cols-[minmax(0,1fr)_auto] lg:grid-rows-[auto_auto_auto_minmax(0,1fr)] lg:[grid-template-areas:'header_header'_'context_context'_'sep_sep'_'main_dock']"
    >
      <div className="[grid-area:header] flex min-w-0 flex-col">
        <MesAppBar
          title={recordId}
          subtitle={back.label}
          back={{ to: back.to }}
          actions={renderMenu({ size: "lg", align: "end" })}
        />
        <header className="flex h-[var(--header-height)] shrink-0 items-center gap-2 border-b px-2 max-md:h-auto max-md:py-0">
          <HStack className="w-full justify-between max-md:flex-wrap max-md:gap-y-1">
            <div className="flex items-center gap-0 max-md:hidden">
              <SidebarTrigger />
              <Button
                asChild
                variant="ghost"
                leftIcon={<LuChevronLeft />}
                className="pl-2"
              >
                <Link to={back.to}>{back.label}</Link>
              </Button>
            </div>
            <div className="flex min-w-0 items-center gap-2 overflow-x-auto scrollbar-hide scroll-fade-x max-md:w-full">
              <TabsList
                aria-label={t`Record sections`}
                className="ml-auto shrink-0 max-md:ml-0 max-md:w-full max-md:border-b-0 max-md:[&>*]:flex-1"
              >
                {tabs.map((item) => (
                  <TabsTrigger
                    key={item.value}
                    value={item.value}
                    disabled={item.disabled}
                  >
                    {item.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
          </HStack>
        </header>
      </div>

      <div className="[grid-area:context] flex shrink-0 flex-wrap lg:flex-nowrap items-center justify-start px-4 lg:pl-6 py-2 min-h-[var(--header-height)] bg-card gap-x-2 gap-y-1 md:gap-x-4 w-full min-w-0">
        <HStack className="min-w-22 shrink-0 justify-between max-md:hidden">
          {/* The page's h1 at md and up; MesAppBar holds it on phones. */}
          <Heading as="h1" size="h4">
            {recordId}
          </Heading>
          {renderMenu({ align: "start" })}
        </HStack>
        <HStack className="flex w-full lg:w-auto min-w-0 lg:flex-1 justify-start lg:justify-end items-center gap-3 overflow-x-auto lg:overflow-hidden scrollbar-hide scroll-fade-x [&>*]:shrink-0 lg:[&>*]:shrink max-md:flex-wrap max-md:overflow-visible max-md:gap-y-1 max-md:mask-none max-md:[&>*]:shrink">
          {chips}
        </HStack>
      </div>
      <Separator className="[grid-area:sep]" />

      {children}
      {dock}
    </Tabs>
  );
}

/** One fact in the strip under the top bar: an icon and a short text. */
export function WorkRecordChip({
  icon,
  children
}: {
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <HStack className="min-w-0 justify-start space-x-2">
      {icon && (
        <span className="flex shrink-0 text-muted-foreground">{icon}</span>
      )}
      <span className="text-sm truncate">{children}</span>
    </HStack>
  );
}

/**
 * A tab's scrolling pane. The scroll (and `scroll-fade`) is on the inner div,
 * never the tab panel: `scroll-fade` is a scroll-driven animation that never
 * ends, and Radix keeps a closing tab mounted until its animation does, so
 * every visited tab stayed drawn over the open one.
 */
export function WorkRecordPane({
  value,
  children
}: {
  value: string;
  children: ReactNode;
}) {
  return (
    <TabsContent value={value} className="[grid-area:main] mt-0 h-full min-h-0">
      <div className="h-full w-full min-w-0 overflow-y-auto scroll-fade scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent">
        {children}
      </div>
    </TabsContent>
  );
}

/** The pane's heading: what is being worked on. */
export function WorkRecordTitle({
  title,
  subtitle
}: {
  title: ReactNode;
  subtitle?: ReactNode;
}) {
  return (
    <>
      <div className="flex items-start justify-between gap-4 p-4 lg:p-6">
        <div className="flex flex-col flex-grow min-w-0">
          <Heading size="h3" className="line-clamp-1">
            {title}
          </Heading>
          {subtitle && (
            <p className="text-muted-foreground line-clamp-1">{subtitle}</p>
          )}
        </div>
      </div>
      <Separator />
    </>
  );
}

/** The row of stat cards under the title. */
export function WorkRecordStats({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start p-4 lg:p-6">
      <div className="grid gap-4 grid-cols-2 xl:grid-cols-3 w-full min-w-0">
        {children}
      </div>
    </div>
  );
}

export function WorkRecordStat({
  title,
  icon,
  className,
  children
}: {
  title: ReactNode;
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center gap-2 justify-between">
        <CardTitle>{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** A section of the pane, with its heading and an optional action. */
export function WorkRecordSection({
  title,
  description,
  action,
  children
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <Separator />
      <div className="flex flex-col gap-4 p-4 lg:p-6 w-full">
        <HStack className="justify-between w-full">
          <Heading size="h3">{title}</Heading>
          {action}
        </HStack>
        {description && (
          <p className="text-muted-foreground text-sm -mt-2">{description}</p>
        )}
        {children}
      </div>
    </>
  );
}

/** The bordered panel a section's table sits in. */
export function WorkRecordTablePanel({ children }: { children: ReactNode }) {
  return (
    <div className="w-full overflow-hidden rounded-lg border bg-card">
      {children}
    </div>
  );
}

/**
 * The operation view's dock: the record's properties, the clock button with
 * its caption, and the actions. `actions` are the full-width buttons from
 * `lg`; `compactActions` the round buttons below it.
 */
export function WorkRecordDock({
  properties = [],
  clock,
  caption,
  actions,
  compactActions
}: {
  properties?: { label: ReactNode; value: ReactNode }[];
  clock?: ReactNode;
  caption?: ReactNode;
  actions?: ReactNode;
  compactActions?: ReactNode;
}) {
  return (
    <Controls className="[grid-area:dock]">
      <div className="flex w-full min-w-0 items-center gap-2 lg:flex-col lg:py-2 max-md:flex-wrap max-md:gap-y-2">
        {properties.length > 0 && (
          <dl className="hidden w-full gap-3 rounded-lg border bg-card p-3 lg:grid">
            {properties.map((property, index) => (
              <div key={index} className="min-w-0">
                <dt className="text-xs text-muted-foreground">
                  {property.label}
                </dt>
                <dd className="line-clamp-1 text-sm font-medium">
                  {property.value}
                </dd>
              </div>
            ))}
          </dl>
        )}
        {clock && (
          <div className="flex flex-col items-center gap-0.5 md:contents max-md:min-w-0 max-md:flex-1 max-md:flex-row max-md:gap-3">
            {clock}
            {caption && (
              <div
                className={cn(
                  "flex flex-col items-center gap-0.5 text-center md:max-lg:hidden",
                  "max-md:min-w-0 max-md:items-start max-md:gap-0 max-md:text-left max-md:whitespace-nowrap"
                )}
              >
                {caption}
              </div>
            )}
          </div>
        )}
        {compactActions && (
          <div className="flex flex-row lg:hidden items-center gap-2 justify-center">
            {compactActions}
          </div>
        )}
        {actions && (
          <div className="hidden w-full flex-col gap-2 lg:flex">{actions}</div>
        )}
      </div>
    </Controls>
  );
}
