import type { CreatableMultiSelectProps } from "@carbon/form";
import { CreatableMultiSelect } from "@carbon/form";
import { Badge, HStack } from "@carbon/react";
import { useFetcher } from "@remix-run/react";
import { useMemo } from "react";
import { LuTags } from "react-icons/lu";
import type { action } from "~/routes/x+/settings+/tags.new";
import { path } from "~/utils/path";

type TagsSelectProps = Omit<
  CreatableMultiSelectProps,
  "options" | "value" | "inline"
> & {
  availableTags: { name: string }[];
  table?: string;
  inline?: boolean;
};

const TagsPreview = (
  value: string[],
  options: { value: string; label: string; helper?: string }[],
  maxPreview?: number
) => {
  return (
    <HStack className="space-x-0 flex-grow gap-1 items-start">
      {maxPreview && value.length > maxPreview ? (
        <Badge
          variant="secondary"
          className="border dark:border-none dark:shadow-button-base"
        >
          {value.length} tags
        </Badge>
      ) : (
        value.map((label: string) => (
          <Badge
            className="max-w-[160px] truncate border dark:border-none dark:shadow-button-base"
            key={label}
            variant="secondary"
          >
            {label}
          </Badge>
        ))
      )}
    </HStack>
  );
};

const Tags = ({ table, availableTags, ...props }: TagsSelectProps) => {
  const newTagFetcher = useFetcher<typeof action>();

  const options = useMemo(
    () =>
      availableTags.map((c) => ({
        value: c.name,
        label: c.name,
      })),
    [availableTags]
  );

  return (
    <CreatableMultiSelect
      label={props?.label ?? "Tag"}
      options={options}
      {...props}
      showCreateOptionOnEmpty={false}
      inline={props.inline ? TagsPreview : undefined}
      inlineIcon={<LuTags />}
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
