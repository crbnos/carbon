import {
  Checkbox,
  HStack,
  IconButton,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@carbon/react";
import { useMemo } from "react";
import { LuListPlus, LuX } from "react-icons/lu";
import { Avatar } from "~/components";
import useUserSelectContext from "../provider";
import { isGroup } from "../useUserSelect";

const SelectionList = () => {
  const {
    innerProps: {
      alwaysSelected,
      checkedSelections,
      readOnly,
      selectionsMaxHeight,
      width,
    },
    instanceId,
    selectionItemsById,
    onDeselect,
    onExplode,
    onToggleChecked,
  } = useUserSelectContext();

  const selected = useMemo(
    () =>
      Object.values(selectionItemsById).sort((a, b) =>
        a.label < b.label ? -1 : 0
      ),
    [selectionItemsById]
  );

  return (
    <ul
      className="w-full mt-1"
      style={{
        maxWidth: width,
        maxHeight: selectionsMaxHeight,
        overflowY: selectionsMaxHeight ? "auto" : undefined,
      }}
    >
      {selected.map((item) => {
        const id = `UserSelection:SelectedItem-${item.id}`;
        const canExpand = !checkedSelections && !readOnly && isGroup(item);

        return (
          <li className="p-2 rounded-md hover:bg-accent" key={item.id}>
            <div className="flex items-center space-x-2">
              {checkedSelections ? (
                <HStack className="w-full">
                  <Checkbox
                    id={`${instanceId}:${id}:checkbox`}
                    data-testid={id}
                    isChecked={item.isChecked}
                    onCheckedChange={() => onToggleChecked(item)}
                  />
                  <p className="flex-grow text-sm line-clamp-1">{item.label}</p>
                </HStack>
              ) : (
                <>
                  {"fullName" in item ? (
                    <Avatar
                      name={item.fullName ?? undefined}
                      path={item.avatarUrl}
                      size="sm"
                    />
                  ) : (
                    <Avatar name={item.name} path={null} size="sm" />
                  )}

                  <div className="flex items-center flex-grow">
                    <p className="text-sm line-clamp-1">{item.label}</p>
                  </div>
                </>
              )}

              {!!canExpand && (
                <Tooltip>
                  <TooltipTrigger>
                    <IconButton
                      aria-label={`Expand ${item.label}`}
                      icon={<LuListPlus />}
                      onClick={() => onExplode(item)}
                      variant="secondary"
                    />
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <span>Expand</span>
                  </TooltipContent>
                </Tooltip>
              )}

              {!readOnly && !alwaysSelected.includes(item.id) && (
                <Tooltip>
                  <TooltipTrigger>
                    <IconButton
                      aria-label={`Remove ${item.label}`}
                      icon={<LuX />}
                      onClick={() => onDeselect(item)}
                      variant="secondary"
                    />
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <span>Remove</span>
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
};

export default SelectionList;
