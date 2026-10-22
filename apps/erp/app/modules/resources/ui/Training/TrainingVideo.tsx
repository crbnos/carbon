// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useAction } from "@carbon/query";
import { Button, HStack, Input, toast } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { FormEvent } from "react";
import { useState } from "react";
import { LuCirclePlay, LuPencil } from "react-icons/lu";
import type { action } from "~/routes/x+/training+/update";
import { path } from "~/utils/path";
import { getYouTubeVideoId } from "../../resources.models";

// YouTube's own embedded player, from the privacy-enhanced domain (no
// cookies until the viewer presses play).
export function TrainingVideoPlayer({ videoUrl }: { videoUrl: string }) {
  const { t } = useLingui();
  const videoId = getYouTubeVideoId(videoUrl);
  if (!videoId) return null;

  return (
    <div className="relative w-full aspect-video overflow-hidden rounded-lg border border-border bg-black">
      <iframe
        className="absolute inset-0 h-full w-full"
        src={`https://www.youtube-nocookie.com/embed/${videoId}?rel=0`}
        title={t`Training video`}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        referrerPolicy="strict-origin-when-cross-origin"
        allowFullScreen
      />
    </div>
  );
}

// The video side of a training's content: add, change and watch the video.
const TrainingVideo = ({
  trainingId,
  videoUrl,
  canEdit
}: {
  trainingId: string;
  videoUrl: string | null;
  canEdit: boolean;
}) => {
  const { t } = useLingui();
  const [isEditing, setIsEditing] = useState(false);
  const [link, setLink] = useState("");
  const [isInvalid, setIsInvalid] = useState(false);

  const fetcher = useAction<typeof action>({
    onSuccess: () => {
      setIsEditing(false);
      setLink("");
    },
    onError: (data) => {
      if (data?.error) toast.error(data.error.message);
    }
  });
  const isBusy = fetcher.state !== "idle";

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!getYouTubeVideoId(link)) {
      setIsInvalid(true);
      return;
    }
    const formData = new FormData();
    formData.append("ids", trainingId);
    formData.append("field", "videoUrl");
    formData.append("value", link.trim());
    fetcher.submit(formData, {
      method: "post",
      action: path.to.bulkUpdateTraining
    });
  };

  if (!videoUrl || isEditing) {
    if (!canEdit) {
      return (
        <p className="text-sm text-muted-foreground">
          <Trans>No video added</Trans>
        </p>
      );
    }
    return (
      <form onSubmit={save} className="flex flex-col gap-2 w-full">
        <HStack className="w-full">
          <Input
            autoFocus
            value={link}
            placeholder="https://www.youtube.com/watch?v=…"
            aria-label={t`YouTube link`}
            isInvalid={isInvalid}
            isDisabled={isBusy}
            onChange={(event) => {
              setLink(event.target.value);
              setIsInvalid(false);
            }}
          />
          <Button type="submit" isLoading={isBusy} isDisabled={!link.trim()}>
            <Trans>Save</Trans>
          </Button>
          {videoUrl && (
            <Button
              variant="secondary"
              isDisabled={isBusy}
              onClick={() => {
                setIsEditing(false);
                setLink("");
                setIsInvalid(false);
              }}
            >
              <Trans>Cancel</Trans>
            </Button>
          )}
        </HStack>
        <p
          className={
            isInvalid
              ? "text-sm text-destructive"
              : "text-sm text-muted-foreground"
          }
        >
          {isInvalid ? (
            <Trans>Enter a YouTube video link</Trans>
          ) : (
            <Trans>Paste a YouTube video link</Trans>
          )}
        </p>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-3 w-full">
      <HStack className="w-full justify-between">
        <HStack spacing={2} className="text-sm min-w-0">
          <LuCirclePlay className="shrink-0 text-muted-foreground" />
          <a
            href={videoUrl}
            target="_blank"
            rel="noreferrer"
            className="truncate hover:underline"
          >
            {videoUrl}
          </a>
        </HStack>
        <Button
          variant="secondary"
          leftIcon={<LuPencil />}
          isDisabled={!canEdit}
          onClick={() => {
            setLink(videoUrl);
            setIsEditing(true);
          }}
        >
          <Trans>Change</Trans>
        </Button>
      </HStack>
      <TrainingVideoPlayer videoUrl={videoUrl} />
    </div>
  );
};

export default TrainingVideo;
