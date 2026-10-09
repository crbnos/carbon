// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  MENU_ITEM_SHORTCUTS,
  PrefetchLink,
  Subheading,
  useDebounce,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Reorder } from "motion/react";
import { useEffect, useState } from "react";
import {
  LuChevronDown,
  LuChevronRight,
  LuEllipsisVertical,
  LuGripVertical,
  LuTrash
} from "react-icons/lu";
import { useSubmit } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import type { RouteGroup } from "~/types";
import { path } from "~/utils/path";
import { SidebarLinks, useSidebarLocation } from "./CollapsibleSidebar";
import {
  SheetNavGroup,
  SheetNavRow,
  useSidebarPresentation
} from "./SidebarPresentation";

type GroupedRoute = RouteGroup["routes"][number];

const matchesRoute = (
  route: GroupedRoute,
  pathname: string,
  exactMatch: boolean
) =>
  route.isActive
    ? route.isActive(pathname)
    : exactMatch
      ? pathname === route.to
      : pathname.includes(route.to);

const GroupedContentSidebar = ({
  groups,
  exactMatch = false
}: {
  groups: RouteGroup[];
  exactMatch?: boolean;
}) => {
  const { t } = useLingui();
  const location = useSidebarLocation((pathname) =>
    groups.some((group) =>
      group.routes.some((route) => matchesRoute(route, pathname, exactMatch))
    )
  );
  const submit = useSubmit();

  const [expandedViews, setExpandedViews] = useState<Record<string, boolean>>(
    () =>
      groups.reduce(
        (acc, group) => {
          group.routes.forEach((route) => {
            if (route.views?.length) {
              acc[route.name] = true;
            }
          });
          return acc;
        },
        {} as Record<string, boolean>
      )
  );

  const [selectedView, setSelectedView] = useState<{
    id: string;
    name: string;
    to: string;
    sortOrder: number;
  } | null>(null);

  const toggleViews = (routeName: string) => {
    setExpandedViews((prev) => ({
      ...prev,
      [routeName]: !prev[routeName]
    }));
  };

  const presentation = useSidebarPresentation();
  const search = `${location.pathname}${location.search}`;
  const isViewActive = (view: { id: string }) =>
    search.includes(`view=${view.id}`);
  // While a saved view is open (view= in the URL), it holds the highlight.
  const isActive = (route: GroupedRoute) =>
    matchesRoute(route, location.pathname, exactMatch) &&
    (Boolean(route.isActive) || exactMatch || !search.includes("view="));

  if (presentation === "title") {
    // Compact app bar title: the item the switcher sheet below ticks.
    for (const route of groups.flatMap((group) => group.routes)) {
      if (!matchesRoute(route, location.pathname, exactMatch)) continue;
      const view = route.views?.find(isViewActive);
      if (view) return <>{view.name}</>;
      if (isActive(route)) return <>{route.name}</>;
    }
    return null;
  }
  if (presentation === "sheet") {
    // Compact section switcher: the same groups, order and active rule as
    // the panel below. Saved views open from here; reordering and deleting
    // them stays on desktop.
    return (
      <div className="flex flex-col">
        {groups.map((group) => (
          <SheetNavGroup key={group.name} title={group.name}>
            {group.routes.map((route) => {
              const views = [...(route.views ?? [])].sort(
                (a, b) => a.sortOrder - b.sortOrder
              );
              return (
                <div key={route.name} className="flex flex-col">
                  <SheetNavRow
                    to={route.to + (route.q ? `?q=${route.q}` : "")}
                    icon={route.icon}
                    label={route.name}
                    isActive={isActive(route)}
                  />
                  {views.map((view) => (
                    <SheetNavRow
                      key={view.to}
                      to={view.to}
                      label={view.name}
                      isActive={isViewActive(view)}
                      inset
                    />
                  ))}
                </div>
              );
            })}
          </SheetNavGroup>
        ))}
      </div>
    );
  }

  return (
    <>
      <SidebarLinks>
        <VStack>
          {groups.map((group) => (
            <VStack
              key={group.name}
              className="border-b border-border p-2 pb-4 space-y-0.5"
            >
              <Subheading as="h4" variant="light" className="pl-4 py-1">
                {group.name}
              </Subheading>
              {group.routes.map((route) => {
                const active = isActive(route);

                const hasViews = route.views && route.views.length > 0;
                const isExpanded = expandedViews[route.name];

                if (hasViews && !(route.name in expandedViews)) {
                  setExpandedViews((prev) => ({
                    ...prev,
                    [route.name]: true
                  }));
                }

                return (
                  <div className="w-full flex flex-col" key={route.name}>
                    <div
                      className="flex items-center gap-x-0.5 relative"
                      data-nav-item=""
                    >
                      <Button
                        asChild
                        leftIcon={route.icon}
                        variant={active ? "active" : "ghost"}
                        className={cn(
                          "justify-start flex-grow truncate",
                          active
                            ? "shadow-none dark:shadow-button-base"
                            : "hover:bg-transparent hover:text-active-foreground hover:scale-100 focus-visible:scale-100"
                        )}
                      >
                        <PrefetchLink
                          to={route.to + (route.q ? `?q=${route.q}` : "")}
                        >
                          {route.name}
                        </PrefetchLink>
                      </Button>
                      {hasViews && (
                        <IconButton
                          aria-label={t`Toggle views`}
                          icon={
                            isExpanded ? <LuChevronDown /> : <LuChevronRight />
                          }
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleViews(route.name)}
                          className="absolute right-1 flex-shrink-0 text-foreground/70 hover:text-foreground"
                        />
                      )}
                    </div>
                    {hasViews && isExpanded && (
                      <ViewsReorderGroup
                        views={route.views ?? []}
                        isViewActive={isViewActive}
                        onReorder={(updates) => {
                          const formData = new FormData();
                          formData.append("updates", JSON.stringify(updates));
                          submit(formData, {
                            action: path.to.saveViewOrder,
                            method: "post",
                            navigate: false
                          });
                        }}
                        onDelete={(view) => setSelectedView(view)}
                      />
                    )}
                  </div>
                );
              })}
            </VStack>
          ))}
        </VStack>
      </SidebarLinks>
      {selectedView && (
        <ConfirmDelete
          isOpen={!!selectedView}
          action={path.to.deleteSavedView(selectedView.id)}
          name={selectedView.name}
          text={t`Are you sure you want to delete the view "${selectedView.name}"?`}
          onCancel={() => setSelectedView(null)}
          onSubmit={() => {
            setSelectedView(null);
          }}
        />
      )}
    </>
  );
};

const ViewsReorderGroup = ({
  views,
  isViewActive,
  onReorder,
  onDelete
}: {
  views: { id: string; name: string; to: string; sortOrder: number }[];
  isViewActive: (view: { id: string }) => boolean;
  onReorder: (
    updates: { id: string; name: string; to: string; sortOrder: number }[]
  ) => void;
  onDelete: (view: {
    id: string;
    name: string;
    to: string;
    sortOrder: number;
  }) => void;
}) => {
  const { t } = useLingui();
  const [sortedViews, setSortedViews] = useState(() => {
    if (views && views[Symbol.iterator]) {
      return [...views].sort((a, b) => a.sortOrder - b.sortOrder);
    }
    return [];
  });

  // Everything a row shows or links to. Names alone missed a view whose
  // filters or position changed: its link stayed the old one until a reload.
  const viewsSignature = views
    .map((view) => `${view.id}|${view.name}|${view.to}|${view.sortOrder}`)
    .sort()
    .join(",");

  // biome-ignore lint/correctness/useExhaustiveDependencies: views is followed by value
  useEffect(() => {
    setSortedViews([...views].sort((a, b) => a.sortOrder - b.sortOrder));
  }, [viewsSignature]);

  const debouncedOnReorder = useDebounce(onReorder, 500, true);

  return (
    <Reorder.Group
      axis="y"
      values={sortedViews}
      onReorder={(newOrder) => {
        const updates = newOrder.map((view, index) => ({
          ...view,
          sortOrder: index
        }));

        setSortedViews(updates);
        debouncedOnReorder(updates);
      }}
      className="flex flex-col gap-y-0.5 my-0.5"
    >
      {sortedViews.map((view) => {
        const active = isViewActive(view);
        return (
          <Reorder.Item key={view.to} value={view} className="w-full">
            <div
              className="group/view flex items-center relative"
              data-nav-item=""
            >
              <Button
                asChild
                variant={active ? "active" : "ghost"}
                className={cn(
                  "justify-start text-sm pl-7 pr-7 truncate flex-grow !shadow-none",
                  active
                    ? "shadow-none border-active-foreground/30 dark:border-none dark:shadow-button-base"
                    : "hover:bg-transparent hover:text-active-foreground"
                )}
              >
                <PrefetchLink to={view.to}>{view.name}</PrefetchLink>
              </Button>
              <IconButton
                aria-label={t`Drag handle`}
                icon={<LuGripVertical />}
                variant="ghost"
                size="sm"
                className="flex-shrink-0 md:opacity-0 group-hover/view:opacity-100 absolute left-1"
              />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton
                    aria-label={t`Options`}
                    icon={<LuEllipsisVertical />}
                    variant="ghost"
                    size="sm"
                    className="absolute right-1 flex-shrink-0 md:opacity-0 group-hover/view:opacity-100 data-[state=open]:opacity-100 text-foreground/70 hover:text-foreground"
                  />
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem
                    shortcut={MENU_ITEM_SHORTCUTS.delete}
                    destructive
                    onSelect={() => onDelete(view)}
                  >
                    <DropdownMenuIcon icon={<LuTrash />} />
                    <Trans>Delete View</Trans>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </Reorder.Item>
        );
      })}
    </Reorder.Group>
  );
};

export default GroupedContentSidebar;
