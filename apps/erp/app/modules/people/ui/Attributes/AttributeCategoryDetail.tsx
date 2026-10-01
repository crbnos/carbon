// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  ActionMenu,
  Badge,
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
  useDisclosure
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Reorder } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { AiOutlineNumber } from "react-icons/ai";
import { BiText } from "react-icons/bi";
import { BsCalendarDate, BsToggleOn } from "react-icons/bs";
import { CgProfile } from "react-icons/cg";
import { LuGripVertical, LuPencil, LuTrash } from "react-icons/lu";
import { Link, useFetcher } from "react-router";
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
  onClose
}: AttributeCategoryDetailProps) => {
  const { t } = useLingui();
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
                [attribute.id]: attribute
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
    if (Array.isArray(attributeCategory.userAttribute)) {
      const sorted = [...attributeCategory.userAttribute]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((attribute) => attribute.id);
      setSortOrder(sorted);
    }
  }, [attributeCategory.userAttribute]);

  const onReorder = (newOrder: string[]) => {
    const updates: Record<string, number> = {};

    // Update all positions to ensure consistent ordering
    newOrder.forEach((id, index) => {
      updates[id] = index + 1;
    });

    setSortOrder(newOrder);
    updateSortOrder(updates);
  };

  const updateSortOrder = useDebounce(
    (updates: Record<string, number>) => {
      let formData = new FormData();
      formData.append("updates", JSON.stringify(updates));
      sortOrderFetcher.submit(formData, { method: "post" });
    },
    1000,
    true
  );

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
            <Trans>Edit Attribute</Trans>
          </Link>
        </MenuItem>
        <MenuItem
          destructive
          onClick={() => onDelete(attributeMap[attributeId])}
        >
          <MenuIcon icon={<LuTrash />} />
          <Trans>Delete Attribute</Trans>
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
            <DrawerTitle>
              {attributeCategory.emoji ? (
                <span>{attributeCategory.emoji}</span>
              ) : null}{" "}
              {attributeCategory.name}
            </DrawerTitle>
            <DrawerDescription>
              <Badge
                variant={attributeCategory.public ? "default" : "secondary"}
              >
                {attributeCategory.public ? (
                  <Trans>Public</Trans>
                ) : (
                  <Trans>Private</Trans>
                )}
              </Badge>
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
                          aria-label={t`Drag handle`}
                          icon={<LuGripVertical />}
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
                              t`Unknown`
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
            <New to={`new?${params.toString()}`} label={t`Attribute`} />
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
      {selectedAttribute && selectedAttribute.id && (
        <ConfirmDelete
          isOpen={deleteModal.isOpen}
          action={path.to.deleteAttribute(selectedAttribute.id)}
          name={selectedAttribute?.name ?? ""}
          text={t`Are you sure you want to deactivate the ${selectedAttribute?.name} attribute?`}
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
  isUser
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
