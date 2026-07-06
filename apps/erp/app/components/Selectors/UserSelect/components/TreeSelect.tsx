import { cn, Spinner } from "@carbon/react";
import { FaChevronRight } from "react-icons/fa";
import { LuCheck, LuUsers } from "react-icons/lu";
import { Avatar } from "~/components";
import useUserSelectContext from "../provider";
import type { IndividualOrGroup, OptionGroup } from "../types";
import { isGroup } from "../useUserSelect";

const UserTreeSelect = () => {
  const {
    aria: { listBoxProps },
    groups,
    innerProps: { isMulti },
    loading,
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
      ) : groups.length > 0 ? (
        groups.map((group) => <Group key={group.uid} group={group} />)
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

const Group = ({ group }: { group: OptionGroup }) => {
  const {
    innerProps: { alwaysSelected },
    onGroupCollapse,
    onGroupExpand,
    prefetchGroup,
    focusedId,
    onSelect,
    onDeselect,
    selectionItemsById,
    loadingGroups
  } = useUserSelectContext();

  const isFocused = group.uid === focusedId;
  const isExpanded = group.expanded && group.items.length > 0;

  const groupId = group.uid.split("_")[1];
  const isLoading = groupId ? loadingGroups?.[groupId] : false;

  return (
    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: suppressed due to migration
    <div
      id={group.uid}
      tabIndex={0}
      className="rounded-md outline-none"
      aria-expanded={isExpanded}
    >
      {/* Group Header */}
      <div
        role="treeitem"
        aria-selected={isExpanded ? "true" : "false"}
        onClick={() =>
          group.expanded ? onGroupCollapse(group.uid) : onGroupExpand(group.uid)
        }
        onMouseEnter={() => {
          if (!group.expanded) prefetchGroup(group.uid);
        }}
        className={cn(
          "flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-2 hover:bg-muted/50 text-sm",
          isFocused && "bg-muted/50"
        )}
      >
        <ExpandIcon isExpanded={isExpanded} />
        <span className="flex-1 truncate">{group.name}</span>
        {isLoading ? (
          <Spinner className="h-3 w-3" />
        ) : (
          <span className="text-[10px] font-normal">{group.items.length}</span>
        )}
      </div>

      {/* Group Items */}
      {isExpanded && (
        <ul role="group" className="flex flex-col gap-0.5 py-1 pl-2">
          {group.items.map((item) => {
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
                  !alwaysSelected.includes(item.id)
                    ? () => (isSelected ? onDeselect(item) : onSelect(item))
                    : undefined
                }
              />
            );
          })}
        </ul>
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
    itemIsGroup && "users" in item
      ? (item.users?.length ?? 0) +
        ("children" in item ? (item.children?.length ?? 0) : 0)
      : 0;

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
          <span className="text-xs text-muted-foreground">
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
