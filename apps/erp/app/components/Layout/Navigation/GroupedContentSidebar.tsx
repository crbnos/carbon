import {
  Button,
  cn,
  IconButton,
  VStack,
  useDebounce,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@carbon/react";
import { Link, useSubmit } from "@remix-run/react";
import { useOptimisticLocation } from "~/hooks";
import type { RouteGroup } from "~/types";
import { CollapsibleSidebar } from "./CollapsibleSidebar";
import { Reorder } from "framer-motion";
import {
  LuChevronDown,
  LuChevronRight,
  LuEllipsisVertical,
  LuGripVertical,
} from "react-icons/lu";
import { useState } from "react";
import { path } from "~/utils/path";
import { ConfirmDelete } from "~/components/Modals";

const GroupedContentSidebar = ({
  groups,
  width = 240,
  exactMatch = false,
}: {
  groups: RouteGroup[];
  width?: number;
  exactMatch?: boolean;
}) => {
  const location = useOptimisticLocation();
  const submit = useSubmit();

  const [expandedViews, setExpandedViews] = useState<Record<string, boolean>>(
    () =>
      groups.reduce((acc, group) => {
        group.routes.forEach((route) => {
          if (route.views?.length) {
            acc[route.name] = true;
          }
        });
        return acc;
      }, {} as Record<string, boolean>)
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
      [routeName]: !prev[routeName],
    }));
  };

  return (
    <CollapsibleSidebar width={width}>
      <div className="overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent h-full w-full pb-8">
        <VStack>
          {groups.map((group) => (
            <VStack
              key={group.name}
              className="border-b border-border p-2 pb-4 space-y-0.5"
            >
              <h4 className="text-xxs text-foreground/70 uppercase font-light tracking-wide pl-4 py-1">
                {group.name}
              </h4>
              {group.routes.map((route) => {
                const isActive = exactMatch
                  ? location.pathname === route.to
                  : location.pathname.includes(route.to) &&
                    !route.views?.some((subRoute) =>
                      `${location.pathname}${location.search}`.includes(
                        subRoute.to
                      )
                    );

                const hasViews = route.views && route.views.length > 0;
                const isExpanded = expandedViews[route.name];

                if (hasViews && !(route.name in expandedViews)) {
                  setExpandedViews((prev) => ({
                    ...prev,
                    [route.name]: true,
                  }));
                }

                return (
                  <div className="w-full flex flex-col" key={route.name}>
                    <div className="flex items-center gap-x-0.5 relative">
                      <Button
                        asChild
                        leftIcon={route.icon}
                        variant={isActive ? "active" : "ghost"}
                        className={cn(
                          "justify-start truncate flex-grow",
                          !isActive &&
                            "hover:bg-active hover:text-active-foreground"
                        )}
                      >
                        <Link
                          to={route.to + (route.q ? `?q=${route.q}` : "")}
                          prefetch="intent"
                        >
                          {route.name}
                        </Link>
                      </Button>
                      {hasViews && (
                        <IconButton
                          aria-label="Toggle views"
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
                        location={location}
                        onReorder={(updates) => {
                          const formData = new FormData();
                          formData.append("updates", JSON.stringify(updates));
                          submit(formData, {
                            action: path.to.saveViewOrder,
                            method: "post",
                            navigate: false,
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
      </div>
      {selectedView && (
        <ConfirmDelete
          isOpen={!!selectedView}
          action={path.to.deleteSavedView(selectedView.id)}
          name={selectedView.name}
          text={`Are you sure you want to delete the view "${selectedView.name}"?`}
          onCancel={() => setSelectedView(null)}
          onSubmit={() => {
            setSelectedView(null);
          }}
        />
      )}
    </CollapsibleSidebar>
  );
};

const ViewsReorderGroup = ({
  views,
  location,
  onReorder,
  onDelete,
}: {
  views: { id: string; name: string; to: string; sortOrder: number }[];
  location: ReturnType<typeof useOptimisticLocation>;
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
  const [sortedViews, setSortedViews] = useState(() => {
    if (views && views[Symbol.iterator]) {
      return [...views].sort((a, b) => a.sortOrder - b.sortOrder);
    }
    return [];
  });

  const debouncedOnReorder = useDebounce(onReorder, 500, true);

  return (
    <Reorder.Group
      axis="y"
      values={sortedViews}
      onReorder={(newOrder) => {
        const updates = newOrder.map((view, index) => ({
          ...view,
          sortOrder: index,
        }));

        setSortedViews(updates);
        debouncedOnReorder(updates);
      }}
      className="flex flex-col gap-y-0.5 my-0.5"
    >
      {sortedViews.map((view) => {
        const isViewActive = `${location.pathname}${location.search}`.includes(
          view.to
        );
        return (
          <Reorder.Item key={view.to} value={view} className="w-full">
            <div className="group/view flex items-center truncate relative">
              <Button
                asChild
                variant={isViewActive ? "active" : "ghost"}
                className={cn(
                  "justify-start truncate text-sm pl-7 pr-7 flex-grow",
                  !isViewActive &&
                    "hover:bg-active hover:text-active-foreground"
                )}
              >
                <Link to={view.to} prefetch="intent">
                  {view.name}
                </Link>
              </Button>
              <IconButton
                aria-label="Drag handle"
                icon={<LuGripVertical />}
                variant="ghost"
                size="sm"
                className="flex-shrink-0 opacity-0 group-hover/view:opacity-100 absolute left-1"
              />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton
                    aria-label="Options"
                    icon={<LuEllipsisVertical />}
                    variant="ghost"
                    size="sm"
                    className="absolute right-1 flex-shrink-0 opacity-0 group-hover/view:opacity-100 data-[state=open]:opacity-100 text-foreground/70 hover:text-foreground"
                  />
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem destructive onSelect={() => onDelete(view)}>
                    Delete view
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
