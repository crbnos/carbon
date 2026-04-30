import { ValidatedForm } from "@carbon/form";
import {
  Avatar,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  HStack,
  Popover,
  PopoverContent,
  PopoverTrigger,
  VStack
} from "@carbon/react";
import data from "@emoji-mart/data";
import Picker from "@emoji-mart/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useState } from "react";
import { useFetcher, useNavigate } from "react-router";
import z from "zod";
import { Tags } from "~/components/Form";
import { useDateFormatter } from "~/hooks";
import { useTags } from "~/hooks/useTags";
import type { Suggestion } from "~/modules/resources";
import { path } from "~/utils/path";

type SuggestionDetailsProps = {
  suggestion: Suggestion;
  tags: { name: string }[];
};

type EmojiData = {
  native: string;
  id: string;
  name: string;
};

export default function SuggestionDetails({
  suggestion,
  tags
}: SuggestionDetailsProps) {
  const { t } = useLingui();
  const { formatDate } = useDateFormatter();
  const navigate = useNavigate();
  const onClose = () => navigate(-1);
  const fetcher = useFetcher();
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);

  const { onUpdateTags } = useTags({
    id: suggestion.id ?? "",
    table: "suggestion"
  });

  const onUpdateEmoji = useCallback(
    (emojiData: EmojiData) => {
      if (!suggestion.id) return;
      const formData = new FormData();
      formData.append("emoji", emojiData.native);
      fetcher.submit(formData, {
        method: "post",
        action: path.to.suggestion(suggestion.id)
      });
      setEmojiPickerOpen(false);
    },
    [suggestion.id, fetcher]
  );

  // Use optimistic emoji value
  const currentEmoji =
    fetcher.formData?.get("emoji")?.toString() ??
    (suggestion as { emoji?: string }).emoji ??
    "💡";

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>
            <Trans>Suggestion</Trans>
          </DrawerTitle>
        </DrawerHeader>
        <DrawerBody>
          <VStack spacing={4}>
            <VStack spacing={2} className="w-full">
              <h3 className="text-xs text-muted-foreground">
                <Trans>Emoji</Trans>
              </h3>
              <Popover open={emojiPickerOpen} onOpenChange={setEmojiPickerOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex items-center justify-center rounded-md h-12 w-12 text-3xl hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    {currentEmoji}
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  className="w-auto p-0 border-0 bg-white"
                  align="start"
                  sideOffset={8}
                >
                  <Picker
                    data={data}
                    onEmojiSelect={onUpdateEmoji}
                    theme="light"
                    previewPosition="none"
                    skinTonePosition="none"
                    navPosition="bottom"
                    perLine={8}
                  />
                </PopoverContent>
              </Popover>
            </VStack>

            <VStack spacing={2} className="w-full">
              <h3 className="text-xs text-muted-foreground">
                <Trans>Suggestion</Trans>
              </h3>
              <div className="whitespace-pre-wrap text-sm">
                {suggestion.suggestion}
              </div>
            </VStack>

            <VStack spacing={2} className="w-full">
              <h3 className="text-xs text-muted-foreground">
                <Trans>Submitted By</Trans>
              </h3>
              <HStack spacing={2}>
                <Avatar
                  size="sm"
                  name={suggestion.employeeName ?? undefined}
                  src={suggestion.employeeAvatarUrl ?? undefined}
                />
                <span>{suggestion.employeeName ?? "Anonymous"}</span>
              </HStack>
            </VStack>

            <VStack spacing={2} className="w-full">
              <h3 className="text-xs text-muted-foreground">
                <Trans>Date</Trans>
              </h3>
              <span>{formatDate(suggestion.createdAt)}</span>
            </VStack>

            <VStack spacing={2} className="w-full">
              <h3 className="text-xs text-muted-foreground">
                <Trans>Path</Trans>
              </h3>
              <span className="text-sm font-mono">{suggestion.path}</span>
            </VStack>

            {suggestion.attachmentPath && (
              <VStack spacing={2} className="w-full">
                <h3 className="text-xs text-muted-foreground">
                  <Trans>Attachment</Trans>
                </h3>
                <a
                  href={`/file/preview/private/${suggestion.attachmentPath}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline text-sm"
                >
                  <Trans>View Attachment</Trans>
                </a>
              </VStack>
            )}

            <ValidatedForm
              defaultValues={{
                tags: suggestion.tags ?? []
              }}
              validator={z.object({
                tags: z.array(z.string()).optional()
              })}
              className="w-full"
            >
              <Tags
                availableTags={tags}
                label={t`Tags`}
                name="tags"
                table="suggestion"
                inline
                onChange={onUpdateTags}
              />
            </ValidatedForm>
          </VStack>
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
