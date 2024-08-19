import {
  ActionMenu,
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  HStack,
  IconButton,
  MenuIcon,
  MenuItem,
  useDebounce,
  useDisclosure,
} from "@carbon/react";
import { Link, useFetcher } from "@remix-run/react";
import { Reorder } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { AiOutlineNumber } from "react-icons/ai";
import { BiText } from "react-icons/bi";
import { BsCalendarDate, BsToggleOn } from "react-icons/bs";
import { CgProfile } from "react-icons/cg";
import { LuPencil, LuTrash } from "react-icons/lu";
import { MdOutlineDragIndicator } from "react-icons/md";
import { New } from "~/components";
import { ConfirmDelete } from "~/components/Modals";
import { useUrlParams } from "~/hooks";

import { path } from "~/utils/path";
import type { Attribute, AttributeCategoryDetailType } from "../../types";

type AttributeCategoryDetailProps = {
  attributeCategory: AttributeCategoryDetailType;
  onClose: () => void;
};

const AttributeCategoryDetail = ({
  attributeCategory,
  onClose,
}: AttributeCategoryDetailProps) => {
  const [params] = useUrlParams();
  const sortOrderFetcher = useFetcher<{}>();

  const attributeMap: Record<string, Attribute> = useMemo(
    () =>
      Array.isArray(attributeCategory.userAttribute)
        ? attributeCategory.userAttribute.reduce<Record<string, Attribute>>(
            // @ts-ignore
            (acc, attribute) => {
              if (!attribute) return acc;
              return {
                ...acc,
                [attribute.id]: attribute,
              };
            },
            {}
          )
        : {},
    [attributeCategory]
  );

  const [sortOrder, setSortOrder] = useState<string[]>(
    Array.isArray(attributeCategory.userAttribute)
      ? attributeCategory.userAttribute
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((attribute) => attribute.id)
      : []
  );

  useEffect(() => {
    setSortOrder(
      Array.isArray(attributeCategory.userAttribute)
        ? attributeCategory.userAttribute
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((attribute) => attribute.id)
        : []
    );
  }, [attributeCategory.userAttribute]);

  const onReorder = (newOrder: string[]) => {
    let updates: Record<string, number> = {};
    newOrder.forEach((id, index) => {
      if (id !== sortOrder[index]) {
        updates[id] = index + 1;
      }
    });
    setSortOrder(newOrder);
    updateSortOrder(updates);
  };

  const updateSortOrder = useDebounce((updates: Record<string, number>) => {
    let formData = new FormData();
    formData.append("updates", JSON.stringify(updates));
    sortOrderFetcher.submit(formData, { method: "post" });
  }, 500);

  const deleteModal = useDisclosure();
  const [selectedAttribute, setSelectedAttribute] = useState<
    Attribute | undefined
  >();

  const onDelete = (data?: Attribute) => {
    setSelectedAttribute(data);
    deleteModal.onOpen();
  };

  const onDeleteCancel = () => {
    setSelectedAttribute(undefined);
    deleteModal.onClose();
  };

  const renderContextMenu = (attributeId: string) => {
    return (
      <>
        <MenuItem asChild>
          <Link to={attributeId}>
            <MenuIcon icon={<LuPencil />} />
            Edit Attribute
          </Link>
        </MenuItem>
        <MenuItem onClick={() => onDelete(attributeMap[attributeId])}>
          <MenuIcon icon={<LuTrash />} />
          Delete Attribute
        </MenuItem>
      </>
    );
  };

  return (
    <>
      <Drawer
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{attributeCategory.name}</DrawerTitle>
            <DrawerDescription>
              {attributeCategory.public ? "Public" : "Private"}
            </DrawerDescription>
          </DrawerHeader>
          <DrawerBody>
            {Array.isArray(attributeCategory?.userAttribute) && (
              <Reorder.Group
                axis="y"
                values={sortOrder}
                onReorder={onReorder}
                className="space-y-2 w-full"
              >
                {sortOrder.map((sortId) => {
                  return (
                    <Reorder.Item
                      key={sortId}
                      value={sortId}
                      className="rounded-lg w-full"
                    >
                      <HStack>
                        <IconButton
                          aria-label="Drag handle"
                          icon={<MdOutlineDragIndicator />}
                          variant="ghost"
                        />
                        <p className="flex-grow text-foreground">
                          {
                            // @ts-ignore
                            attributeMap[sortId]?.name
                          }
                        </p>
                        <Button
                          isDisabled
                          leftIcon={getIcon(
                            // @ts-ignore
                            attributeMap[sortId]?.attributeDataType
                          )}
                          variant="ghost"
                        >
                          {
                            // @ts-ignore
                            attributeMap[sortId]?.attributeDataType?.label ??
                              "Unknown"
                          }
                        </Button>
                        <ActionMenu>{renderContextMenu(sortId)}</ActionMenu>
                      </HStack>
                    </Reorder.Item>
                  );
                })}
              </Reorder.Group>
            )}
          </DrawerBody>
          <DrawerFooter>
            <New to={`new?${params.toString()}`} label="Attribute" />
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
      {selectedAttribute && selectedAttribute.id && (
        <ConfirmDelete
          isOpen={deleteModal.isOpen}
          action={path.to.deleteAttribute(selectedAttribute.id)}
          name={selectedAttribute?.name ?? ""}
          text={`Are you sure you want to deactivate the ${selectedAttribute?.name} attribute?`}
          onCancel={onDeleteCancel}
        />
      )}
    </>
  );
};

function getIcon({
  isBoolean,
  isDate,
  isNumeric,
  isText,
  isUser,
}: {
  isBoolean: boolean;
  isDate: boolean;
  isNumeric: boolean;
  isText: boolean;
  isUser: boolean;
}) {
  if (isBoolean) return <BsToggleOn />;
  if (isDate) return <BsCalendarDate />;
  if (isNumeric) return <AiOutlineNumber />;
  if (isText) return <BiText />;
  if (isUser) return <CgProfile />;
}

export default AttributeCategoryDetail;
