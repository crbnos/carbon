import { useCarbon } from "@carbon/auth";
import {
  Hidden,
  Submit,
  TextAreaControlled,
  ValidatedForm
} from "@carbon/form";
import {
  Badge,
  BadgeCloseButton,
  Button,
  Checkbox,
  File,
  HStack,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SidebarMenuButton,
  toast,
  useMode,
  VStack
} from "@carbon/react";
import { getCompanyPrivateBucket } from "@carbon/utils";
import data from "@emoji-mart/data";
import Picker from "@emoji-mart/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { nanoid } from "nanoid";
import type { ChangeEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { LuImage, LuMailbox } from "react-icons/lu";
import { useFetcher, useLocation } from "react-router";
import { useUser } from "~/hooks";
import type { action } from "~/routes/x+/suggestion";
import { suggestionValidator } from "~/services/models";
import { path } from "~/utils/path";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB in bytes

type EmojiData = {
  native: string;
  id: string;
  name: string;
};

const Suggestion = () => {
  const { t } = useLingui();
  const fetcher = useFetcher<typeof action>();
  const location = useLocation();
  const popoverTriggerRef = useRef<HTMLButtonElement>(null);
  const [suggestion, setSuggestion] = useState("");
  const [emoji, setEmoji] = useState("💡");
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [anonymous, setAnonymous] = useState(true);
  const mode = useMode();
  const pickerTheme = mode;
  const [attachment, setAttachment] = useState<{
    name: string;
    path: string;
  } | null>(null);
  const { carbon } = useCarbon();
  const user = useUser();

  const companyId = user.company.id;

  useEffect(() => {
    if (fetcher.data?.success) {
      toast.success(fetcher.data.message);
      setSuggestion("");
      setEmoji("💡");
      setAttachment(null);
      setAnonymous(true);
      popoverTriggerRef.current?.click();
    } else if (fetcher.data?.message) {
      toast.error(fetcher.data.message);
    }
  }, [fetcher.data]);

  const uploadImage = async (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && carbon) {
      const file = e.target.files[0];
      const fileExtension = file.name.substring(file.name.lastIndexOf(".") + 1);

      if (file.size > MAX_FILE_SIZE) {
        toast.error(t`File size exceeds 10MB limit`);
        return;
      }

      const fileName = `${companyId}/suggestions/${nanoid()}.${fileExtension}`;
      const companyPrivateBucket = getCompanyPrivateBucket(companyId);
      const imageUpload = await carbon.storage
        .from(companyPrivateBucket)
        .upload(fileName, file, {
          cacheControl: `${12 * 60 * 60}`,
          upsert: true
        });

      if (imageUpload.error) {
        console.error(imageUpload.error);
        toast.error(t`Failed to upload image`);
      }

      if (imageUpload.data?.path) {
        setAttachment({
          name: file.name,
          path: imageUpload.data.path
        });
      }
    }
  };

  const onEmojiSelect = (emojiData: EmojiData) => {
    setEmoji(emojiData.native);
    setEmojiPickerOpen(false);
  };

  return (
    <Popover>
      <PopoverTrigger ref={popoverTriggerRef} asChild>
        <SidebarMenuButton tooltip={t`Suggestion`}>
          <LuMailbox />
          <span>
            <Trans>Suggestion</Trans>
          </span>
        </SidebarMenuButton>
      </PopoverTrigger>
      <PopoverContent className="w-[380px] ">
        <ValidatedForm
          method="post"
          action={path.to.suggestion}
          validator={suggestionValidator}
          fetcher={fetcher}
        >
          <Hidden name="path" value={location.pathname} />
          <Hidden name="emoji" value={emoji} />
          <Hidden name="attachmentPath" value={attachment?.path ?? ""} />
          <Hidden name="userId" value={anonymous ? "" : user.id} />
          <VStack spacing={2}>
            <VStack spacing={2} className="w-full">
              <TextAreaControlled
                name="suggestion"
                label=""
                value={suggestion}
                onChange={(value) => setSuggestion(value)}
                placeholder={t`Ideas, suggestions or problems?`}
              />
              {attachment && (
                <Badge className="-mt-2 truncate" variant="secondary">
                  {attachment.name}
                  <BadgeCloseButton
                    type="button"
                    onClick={() => {
                      setAttachment(null);
                    }}
                  />
                </Badge>
              )}
            </VStack>
            <HStack className="w-full justify-between">
              <HStack spacing={2}>
                <Checkbox
                  isChecked={anonymous}
                  onCheckedChange={(checked) => setAnonymous(checked === true)}
                />
                <span className="text-sm">
                  <Trans>Submit anonymously</Trans>
                </span>
              </HStack>
              <Popover open={emojiPickerOpen} onOpenChange={setEmojiPickerOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex items-center justify-center rounded-md h-10 w-10 text-2xl hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 shrink-0"
                  >
                    {emoji}
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  className="w-auto p-0 border-0"
                  align="end"
                  sideOffset={8}
                >
                  <Picker
                    data={data}
                    onEmojiSelect={onEmojiSelect}
                    theme={pickerTheme}
                    previewPosition="none"
                    skinTonePosition="none"
                    navPosition="bottom"
                    perLine={8}
                  />
                </PopoverContent>
              </Popover>
            </HStack>
            <HStack className="w-full justify-between">
              <Button
                variant="secondary"
                onClick={() => {
                  setSuggestion("");
                  setEmoji("💡");
                  setAttachment(null);
                  popoverTriggerRef.current?.click();
                }}
              >
                <Trans>Cancel</Trans>
              </Button>
              <HStack spacing={1}>
                <Button
                  isDisabled={suggestion.length === 0}
                  variant="secondary"
                  onClick={() => setSuggestion("")}
                >
                  <Trans>Clear</Trans>
                </Button>
                <File
                  accept="image/*"
                  aria-label="Attach File"
                  className="px-2"
                  isDisabled={!!attachment}
                  variant="secondary"
                  onChange={uploadImage}
                >
                  <LuImage />
                </File>
                <Submit isDisabled={suggestion.length < 3}>
                  <Trans>Send</Trans>
                </Submit>
              </HStack>
            </HStack>
          </VStack>
        </ValidatedForm>
      </PopoverContent>
    </Popover>
  );
};

export default Suggestion;
