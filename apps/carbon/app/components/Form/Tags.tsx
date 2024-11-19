import type { CreatableMultiSelectProps } from "@carbon/form";
import { CreatableMultiSelect } from "@carbon/form";
import { useMount } from "@carbon/react";
import { useFetcher } from "@remix-run/react";
import { useMemo } from "react";
import type { getTagsList } from "~/modules/shared";
import type { action } from "~/routes/x+/settings+/tags.new";
import { path } from "~/utils/path";

type TagsSelectProps = Omit<CreatableMultiSelectProps, "options" | "value"> & {
  table?: string;
};

const Tags = ({ table, ...props }: TagsSelectProps) => {
  const tagsFetcher = useFetcher<Awaited<ReturnType<typeof getTagsList>>>();
  const newTagFetcher = useFetcher<typeof action>();

  useMount(() => {
    tagsFetcher.load(path.to.api.tags(table));
  });

  const options = useMemo(
    () =>
      tagsFetcher.data?.data
        ? tagsFetcher.data?.data.map((c) => ({
            value: c.id,
            label: c.name,
          }))
        : [],
    [tagsFetcher.data]
  );
  return (
    <CreatableMultiSelect
      label={props?.label ?? "Tag"}
      options={options}
      {...props}
      onCreateOption={(option) => {
        if (!option) return;

        const formData = new FormData();
        formData.append("name", option);
        formData.append("table", table ?? "");
        newTagFetcher.submit(formData, {
          method: "post",
          action: path.to.newTag,
        });
      }}
    />
  );
};

Tags.displayName = "Tags";

export default Tags;
