import { HStack, Spinner, cn } from "@carbon/react";
import { FaChevronRight } from "react-icons/fa";
import { RxCheck } from "react-icons/rx";
import useUserSelectContext from "../provider";
import type { IndividualOrGroup, OptionGroup } from "../types";

const UserTreeSelect = () => {
  const {
    aria: { listBoxProps },
    groups,
    innerProps: { isMulti },
    loading,
    onMouseOver,
    refs: { listBoxRef },
  } = useUserSelectContext();

  return (
    <div
      {...listBoxProps}
      aria-multiselectable={isMulti}
      ref={listBoxRef}
      onMouseOver={onMouseOver}
      className="overflow-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent max-h-[300px] my-1 flex flex-col"
    >
      {loading ? (
        <Spinner />
      ) : groups.length > 0 ? (
        groups.map((group) => <Group key={group.uid} group={group} />)
      ) : (
        <p className="text-center">No options found</p>
      )}
    </div>
  );
};

const MoreIcon = ({ isExpanded }: { isExpanded: boolean }) => (
  <FaChevronRight
    className="h-3 w-3"
    style={{
      transition: "transform .25s ease",
      transform: isExpanded ? "rotate(0.25turn)" : undefined,
    }}
  />
);

const Group = ({ group }: { group: OptionGroup }) => {
  const {
    innerProps: { alwaysSelected },
    onGroupCollapse,
    onGroupExpand,
    focusedId,
    onSelect,
    onDeselect,
    selectionItemsById,
  } = useUserSelectContext();

  const isFocused = group.uid === focusedId;
  const isExpanded = group.expanded && group.items.length > 0;

  return (
    <div
      id={group.uid}
      tabIndex={0}
      className="rounded-md outline-none"
      aria-expanded={isExpanded}
    >
      <div
        role="treeitem"
        aria-selected={isExpanded ? "true" : "false"}
        onClick={() =>
          group.expanded ? onGroupCollapse(group.uid) : onGroupExpand(group.uid)
        }
        className={cn(
          "relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 w-full",
          isFocused && "bg-accent text-accent-foreground"
        )}
      >
        <HStack className="w-full justify-between items-center">
          <span className="line-clamp-1">{group.name}</span>
          <MoreIcon isExpanded={isExpanded} />
        </HStack>
      </div>
      {isExpanded && (
        <ul role="group" className="flex flex-col">
          {group.items.map((item) => {
            const isDisabled = item.id in []; // TODO
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
  onClick,
}: {
  id?: string;
  item: IndividualOrGroup;
  isDisabled: boolean;
  isFocused: boolean;
  isSelected: boolean;
  onClick?: () => void;
}) => {
  const name = item.label;

  return (
    <li
      id={id}
      className={cn(
        "relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        (isSelected || isFocused) && "bg-accent text-accent-foreground",
        isDisabled && "opacity-50 pointer-events-none"
      )}
      tabIndex={0}
      aria-selected={isSelected}
      aria-disabled={isDisabled}
      role="treeitem"
      onClick={onClick}
    >
      <HStack spacing={1} className="w-full items-center">
        <RxCheck
          className={cn(
            "block mr-[0.75rem] text-[0.8rem] w-4 h-4",
            isSelected ? "opacity-100" : "opacity-0"
          )}
        />
        <span className="line-clamp-1">{name}</span>
      </HStack>
    </li>
  );
};

export default UserTreeSelect;
