// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { CreatableComboboxProps } from "@carbon/form";
import { CreatableCombobox } from "@carbon/form";
import { useLoaderQuery } from "@carbon/query";
import { useMemo, useRef } from "react";
import { useDrawerItem } from "~/hooks";
import type { getItemPostingGroupsList } from "~/modules/items/items.service";
import ItemPostingGroupForm from "~/modules/items/ui/ItemPostingGroups/ItemPostingGroupForm";
import { path } from "~/utils/path";
import { Enumerable } from "../Enumerable";
import { useEmptyState } from "./emptyStates";

type ItemPostingGroupSelectProps = Omit<
  CreatableComboboxProps,
  "options" | "inline"
> & {
  inline?: boolean;
};

const ItemPostingGroupPreview = (
  value: string,
  options: { value: string; label: string | JSX.Element }[]
) => {
  const itemGroup = options.find((o) => o.value === value);
  return itemGroup?.label ?? null;
};

const ItemPostingGroup = (props: ItemPostingGroupSelectProps) => {
  const create = useDrawerItem<string>();
  const triggerRef = useRef<HTMLButtonElement>(null);

  const options = useItemPostingGroups();

  const emptyMessage = useEmptyState("itemPostingGroup", {
    onCreate: () => create.open("")
  });

  return (
    <>
      <CreatableCombobox
        ref={triggerRef}
        options={
          options.map((o) => ({
            value: o.value,
            label: <Enumerable value={o.label} />
          })) ?? []
        }
        emptyMessage={emptyMessage}
        {...props}
        inline={props.inline ? ItemPostingGroupPreview : undefined}
        label={props?.label ?? "Posting Group"}
        onCreateOption={(option) => {
          create.open(option);
        }}
      />
      {create.item !== null && (
        <ItemPostingGroupForm
          key={create.key}
          open={create.isOpen}
          type="modal"
          onClose={() => {
            create.close();
            create.afterClose(() => triggerRef.current?.click());
          }}
          initialValues={{
            name: create.item
          }}
        />
      )}
    </>
  );
};

ItemPostingGroup.displayName = "ItemPostingGroup";

export default ItemPostingGroup;

export const useItemPostingGroups = () => {
  const itemGroupFetcher = useLoaderQuery<
    Awaited<ReturnType<typeof getItemPostingGroupsList>>
  >(path.to.api.itemPostingGroups);

  const options = useMemo(
    () =>
      itemGroupFetcher.data?.data
        ? itemGroupFetcher.data?.data.map((c) => ({
            value: c.id,
            label: c.name
          }))
        : [],
    [itemGroupFetcher.data]
  );

  return options;
};
