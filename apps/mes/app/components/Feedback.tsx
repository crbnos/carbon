import { useCarbon } from "@carbon/auth";
import {
  Hidden,
  Submit,
  TextAreaControlled,
  ValidatedForm,
} from "@carbon/form";
import {
  Badge,
  BadgeCloseButton,
  Button,
  File,
  HStack,
  Popover,
  PopoverContent,
  PopoverTrigger,
  VStack,
  toast,
} from "@carbon/react";
import { SUPPORT_EMAIL } from "@carbon/utils";
import { useFetcher, useLocation } from "@remix-run/react";
import { nanoid } from "nanoid";
import type { ChangeEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { LuImage } from "react-icons/lu";
import { feedbackValidator } from "~/models/feedback";
import type { action } from "~/routes/x+/feedback";
import { path } from "~/utils/path";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB in bytes
const Feedback = () => {
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
        toast.error("File size exceeds 10MB limit");
        return;
      }

      const imageUpload = await carbon.storage
        .from("feedback")
        .upload(`${nanoid()}.${fileExtension}`, file, {
          cacheControl: `${12 * 60 * 60}`,
          upsert: true,
        });

      if (imageUpload.error) {
        console.error(imageUpload.error);
        toast.error("Failed to upload image");
      }

      if (imageUpload.data?.path) {
        setAttachment({
          name: file.name,
          path: imageUpload.data.path,
        });
      }
    }
  };

  return (
    <Popover>
      <PopoverTrigger ref={popoverTriggerRef} asChild>
        <Button variant="secondary" size="lg">
          Feedback
        </Button>
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
                placeholder="Ideas, suggestions or problems with this page?"
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
                Cancel
              </Button>
              <HStack spacing={1}>
                <Button
                  isDisabled={feedback.length === 0}
                  variant="secondary"
                  onClick={() => setFeedback("")}
                >
                  Clear
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
                <Submit isDisabled={feedback.length < 3}>Send</Submit>
              </HStack>
            </HStack>
            <p className="text-sm">
              Have a technical issue? Contact{" "}
              <a className="text-primary" href={`mailto:${SUPPORT_EMAIL}`}>
                CarbonOS Support.
              </a>
            </p>
          </VStack>
        </ValidatedForm>
      </PopoverContent>
    </Popover>
  );
};

export default Feedback;
