import { useCarbon } from "@carbon/auth";
import {
  Hidden,
  Submit,
  TextAreaControlled,
  ValidatedForm
} from "@carbon/form";
import { getLogger } from "@carbon/logger";
import {
  Badge,
  BadgeCloseButton,
  Button,
  File,
  HStack,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SidebarMenuButton,
  toast,
  VStack
} from "@carbon/react";
import { SUPPORT_EMAIL } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { nanoid } from "nanoid";
import type { ChangeEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { LuImage, LuMessageCircle } from "react-icons/lu";
import { useFetcher, useLocation } from "react-router";
import type { action } from "~/routes/x+/feedback";
import { feedbackValidator } from "~/services/models";
import { path } from "~/utils/path";

const log = getLogger("mes");

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB in bytes

const Feedback = () => {
  const { t } = useLingui();
  const fetcher = useFetcher<typeof action>();
  const location = useLocation();
  const popoverTriggerRef = useRef<HTMLButtonElement>(null);
  const [feedback, setFeedback] = useState("");
  const [attachment, setAttachment] = useState<{
    name: string;
    path: string;
  } | null>(null);
  const { carbon } = useCarbon();

  useEffect(() => {
    if (fetcher.data?.success) {
      toast.success(fetcher.data.message);
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

      const imageUpload = await carbon.storage
        .from("feedback")
        .upload(`${nanoid()}.${fileExtension}`, file, {
          cacheControl: `${12 * 60 * 60}`,
          upsert: true
        });

      if (imageUpload.error) {
        log.error("Failed to upload image", { error: imageUpload.error });
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

  return (
    <Popover>
      <PopoverTrigger ref={popoverTriggerRef} asChild>
        <SidebarMenuButton>
          <LuMessageCircle />
          <span>
            <Trans>Feedback</Trans>
          </span>
        </SidebarMenuButton>
      </PopoverTrigger>
      <PopoverContent className="w-[380px] ">
        <ValidatedForm
          method="post"
          action={path.to.feedback}
          validator={feedbackValidator}
          fetcher={fetcher}
          onSubmit={() => {
            setFeedback("");
            setAttachment(null);
          }}
        >
          <Hidden name="location" value={location.pathname} />
          <Hidden name="attachmentPath" value={attachment?.path ?? ""} />
          <VStack spacing={4}>
            <VStack spacing={2}>
              <TextAreaControlled
                name="feedback"
                label=""
                value={feedback}
                onChange={(value) => setFeedback(value)}
                placeholder={t`Ideas, suggestions or problems with this page?`}
              />
              {attachment && (
                <Badge className="-mt-2 truncate" variant="secondary">
                  {attachment.name}
                  <BadgeCloseButton
                    type="button"
                    onClick={(e) => {
                      setAttachment(null);
                    }}
                  />
                </Badge>
              )}
            </VStack>
            <HStack className="w-full justify-between">
              <Button
                variant="secondary"
                onClick={() => {
                  setFeedback("");
                  setAttachment(null);
                  popoverTriggerRef.current?.click();
                }}
              >
                <Trans>Cancel</Trans>
              </Button>
              <HStack spacing={1}>
                <Button
                  isDisabled={feedback.length === 0}
                  variant="secondary"
                  onClick={() => setFeedback("")}
                >
                  <Trans>Clear</Trans>
                </Button>
                <File
                  accept="image/*"
                  aria-label={t`Attach File`}
                  className="px-2"
                  isDisabled={!!attachment}
                  variant="secondary"
                  onChange={uploadImage}
                >
                  <LuImage />
                </File>
                <Submit isDisabled={feedback.length < 3}>
                  <Trans>Send</Trans>
                </Submit>
              </HStack>
            </HStack>
            <p className="text-sm">
              <Trans>
                Have a technical issue? Contact{" "}
                <a className="text-primary" href={`mailto:${SUPPORT_EMAIL}`}>
                  Carbon Support.
                </a>
              </Trans>
            </p>
          </VStack>
        </ValidatedForm>
      </PopoverContent>
    </Popover>
  );
};

export default Feedback;
