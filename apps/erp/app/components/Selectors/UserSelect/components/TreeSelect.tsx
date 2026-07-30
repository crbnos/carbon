import { cn, Spinner } from "@carbon/react";
import { useEffect } from "react";
import { FaChevronRight } from "react-icons/fa";
import { LuCheck, LuUsers } from "react-icons/lu";
import { useInView } from "react-intersection-observer";
import { Avatar } from "~/components";
import useUserSelectContext from "../provider";
import type { GroupNode, IndividualOrGroup } from "../types";
import { isGroup } from "../useUserSelect";

const UserTreeSelect = () => {
  const {
    aria: { listBoxProps },
    viewModel,
    innerProps: { isMulti },
    loading,
    loadMore,
    onMouseOver,
    refs: { listBoxRef }
  } = useUserSelectContext();

  return (
    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: suppressed due to migration
    <div
      {...listBoxProps}
      aria-multiselectable={isMulti}
      ref={listBoxRef}
      onMouseOver={onMouseOver}
      className="overflow-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent max-h-[300px] my-1 flex flex-col gap-1"
    >
      {loading ? (
        <div className="flex items-center justify-center py-4">
          <Spinner />
        </div>
      ) : viewModel.mode === "search" ? (
        <SearchResults />
      ) : viewModel.nodes.length > 0 ? (
        <>
          {viewModel.nodes.map((node) => (
            <GroupRow key={node.uid} node={node} />
          ))}
          {viewModel.hasMore && (
            <SentinelRow onVisible={loadMore} loading={viewModel.loadingMore} />
          )}
        </>
      ) : (
        <p className="text-center text-sm text-muted-foreground py-4">
          No options found
        </p>
      )}
    </div>
  );
};

const ExpandIcon = ({ isExpanded }: { isExpanded: boolean }) => (
  <FaChevronRight
    className={cn(
      "h-3 w-3 text-muted-foreground transition-transform duration-200",
      isExpanded && "rotate-90"
    )}
  />
);

/** Loads the next page of top-level groups when scrolled into view. */
const SentinelRow = ({
  onVisible,
  loading
}: {
  onVisible: () => void;
  loading: boolean;
}) => {
  const {
    refs: { listBoxRef }
  } = useUserSelectContext();
  // Root must be the tree's own scrollport: the popover can be clipped by an
  // ancestor (drawer body overflow), which makes viewport-rooted observation
  // never intersect even when the user scrolls the list to the bottom.
  const { ref, inView } = useInView({
    threshold: 0,
    root: listBoxRef.current
  });

  useEffect(() => {
    if (inView && !loading) {
      onVisible();
    }
  }, [inView, loading, onVisible]);

  return (
    <div ref={ref} className="flex items-center justify-center py-2">
      {loading && <Spinner className="h-4 w-4" />}
    </div>
  );
};

/**
 * A group at any depth: the row selects the group (when groups are
 * selectable); the chevron expands/collapses; hovering prefetches members.
 */
const GroupRow = ({
  node,
  inheritedSelected = false
}: {
  node: GroupNode;
  /** True when an ancestor group is selected — forces this row checked + locked. */
  inheritedSelected?: boolean;
}) => {
  const {
    innerProps: { alwaysSelected, usersOnly },
    focusedId,
    onDeselect,
    onGroupCollapse,
    onGroupExpand,
    onSelect,
    prefetchGroup,
    selectionItemsById
  } = useUserSelectContext();

  const { group, uid, expanded, loading, members } = node;

  const isFocused = uid === focusedId;
  // Selected directly, or implicitly because an ancestor group is selected.
  const isSelected = inheritedSelected || group.id in selectionItemsById;
  // Locked when an ancestor is selected (included via that ancestor, can't be
  // toggled off) or when force-selected via alwaysSelected.
  const isDisabled =
    inheritedSelected || (alwaysSelected?.includes(group.id) ?? false);
  // The seeded roots ("All Employees/Customers/Suppliers") are select-all
  // targets, not folders — never expandable; their members are top-level siblings.
  const canExpand = !group.isRoot && group.userCount + group.groupCount > 0;
  const isOpen = expanded && members !== null;
  const isEmpty =
    members !== null &&
    members.groups.length === 0 &&
    members.users.length === 0;

  const selectionItem = (): IndividualOrGroup => ({
    ...group,
    users: [],
    memberCount: group.userCount + group.groupCount,
    uid,
    label: group.name || ""
  });

  const handleRowClick = () => {
    if (usersOnly) {
      if (canExpand) {
        expanded ? onGroupCollapse(uid) : onGroupExpand(uid);
      }
      return;
    }
    if (isDisabled) return;
    if (isSelected) {
      onDeselect(selectionItem());
    } else {
      onSelect(selectionItem());
    }
  };

  return (
    <div
      id={uid}
      role="treeitem"
      tabIndex={0}
      data-expandable={canExpand ? "true" : "false"}
      aria-expanded={canExpand ? expanded : undefined}
      aria-selected={isSelected}
      aria-disabled={isDisabled}
      className="rounded-md outline-none"
    >
      {/* Group Header */}
      <div
        onClick={handleRowClick}
        onMouseEnter={() => {
          if (!expanded) prefetchGroup(group.id);
        }}
        className={cn(
          "flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-2 hover:bg-muted/50 text-sm",
          isFocused && "bg-muted/50",
          isSelected && "bg-accent",
          isDisabled && "opacity-50 pointer-events-none"
        )}
      >
        {canExpand ? (
          <button
            type="button"
            aria-label={expanded ? "Collapse group" : "Expand group"}
            onClick={(e) => {
              e.stopPropagation();
              expanded ? onGroupCollapse(uid) : onGroupExpand(uid);
            }}
            className="-m-1.5 flex items-center justify-center rounded-md p-1.5 hover:bg-muted pointer-events-auto"
          >
            <ExpandIcon isExpanded={expanded} />
          </button>
        ) : (
          <span className="h-3 w-3 shrink-0" />
        )}

        {!usersOnly && (
          <div
            className={cn(
              "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
              isSelected
                ? "border-primary bg-primary text-primary-foreground"
                : "border-muted-foreground/30 bg-background"
            )}
          >
            {isSelected && <LuCheck className="h-3 w-3" />}
          </div>
        )}

        <span className="flex-1 truncate">{group.name}</span>
        {loading && <Spinner className="h-3 w-3" />}
      </div>

      {/* Direct members: child groups first, then users */}
      {isOpen && members && (
        <ul role="group" className="flex flex-col gap-0.5 py-1 pl-2">
          {members.groups.map((child) => (
            <li key={child.uid}>
              <GroupRow node={child} inheritedSelected={isSelected} />
            </li>
          ))}
          {members.users.map((item) => {
            const itemIsFocused = item.uid === focusedId;
            // A selected group implicitly includes (and locks) all its members.
            const itemIsSelected = isSelected || item.id in selectionItemsById;
            const itemIsDisabled =
              isSelected || (alwaysSelected?.includes(item.id) ?? false);

            return (
              <Option
                key={item.uid}
                id={item.uid}
                item={item}
                isDisabled={itemIsDisabled}
                isFocused={itemIsFocused}
                isSelected={itemIsSelected}
                onClick={
                  !itemIsDisabled
                    ? () => (itemIsSelected ? onDeselect(item) : onSelect(item))
                    : undefined
                }
              />
            );
          })}
          {isEmpty && (
            <li className="px-2 py-1.5 text-xs text-muted-foreground">
              No members
            </li>
          )}
        </ul>
      )}
    </div>
  );
};

/** Flat, non-expandable results: matching groups, then matching people. */
const SearchResults = () => {
  const {
    innerProps: { alwaysSelected },
    viewModel,
    focusedId,
    onDeselect,
    onSelect,
    selectionItemsById
  } = useUserSelectContext();

  if (viewModel.mode !== "search") return null;

  const { groups, users, searching } = viewModel;

  if (groups.length === 0 && users.length === 0) {
    return (
      <div className="flex items-center justify-center py-4">
        {searching ? (
          <Spinner />
        ) : (
          <p className="text-center text-sm text-muted-foreground">
            No options found
          </p>
        )}
      </div>
    );
  }

  const renderOption = (item: IndividualOrGroup) => {
    const isDisabled = alwaysSelected?.includes(item.id) ?? false;
    const isFocused = item.uid === focusedId;
    const isSelected = item.id in selectionItemsById;

    return (
      <Option
        key={item.uid}
        id={item.uid}
        item={item}
        isDisabled={isDisabled}
        isFocused={isFocused}
        isSelected={isSelected}
        onClick={
          !isDisabled
            ? () => (isSelected ? onDeselect(item) : onSelect(item))
            : undefined
        }
      />
    );
  };

  return (
    <div className="flex flex-col gap-1">
      {groups.length > 0 && (
        <>
          <p className="px-2 pt-1 text-xs font-medium text-muted-foreground">
            Groups
          </p>
          <ul role="group" className="flex flex-col gap-0.5">
            {groups.map(renderOption)}
          </ul>
        </>
      )}
      {users.length > 0 && (
        <>
          <p className="px-2 pt-1 text-xs font-medium text-muted-foreground">
            People
          </p>
          <ul role="group" className="flex flex-col gap-0.5">
            {users.map(renderOption)}
          </ul>
        </>
      )}
    </div>
  );
};

const Option = ({
  id,
  item,
  isDisabled,
  isFocused,
  isSelected,
  onClick
}: {
  id?: string;
  item: IndividualOrGroup;
  isDisabled: boolean;
  isFocused: boolean;
  isSelected: boolean;
  onClick?: () => void;
}) => {
  const name = item.label;
  const itemIsGroup = isGroup(item);
  const memberCount =
    itemIsGroup && "memberCount" in item ? (item.memberCount ?? 0) : 0;

  // Get avatar info for individuals
  const avatarUrl = "avatarUrl" in item ? item.avatarUrl : null;
  const fullName = "fullName" in item ? item.fullName : null;

  return (
    <li
      id={id}
      className={cn(
        "relative flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
        "hover:bg-accent/50",
        isFocused && "bg-accent/50",
        isSelected && "bg-accent",
        isDisabled && "opacity-50 pointer-events-none"
      )}
      tabIndex={0}
      aria-selected={isSelected}
      aria-disabled={isDisabled}
      role="treeitem"
      onClick={onClick}
    >
      {/* Selection indicator */}
      <div
        className={cn(
          "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
          isSelected
            ? "border-primary bg-primary text-primary-foreground"
            : "border-muted-foreground/30 bg-background"
        )}
      >
        {isSelected && <LuCheck className="h-3 w-3" />}
      </div>

      {/* Avatar or Group Icon */}
      {itemIsGroup ? (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
          <LuUsers className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
      ) : (
        <Avatar name={fullName ?? name} path={avatarUrl} size="sm" />
      )}

      {/* Content */}
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{name}</span>
        {itemIsGroup && memberCount > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {memberCount} {memberCount === 1 ? "member" : "members"}
          </span>
        )}
      </div>

      {/* Group indicator badge */}
      {itemIsGroup && (
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
          Group
        </span>
      )}
    </li>
  );
};

export default UserTreeSelect;
