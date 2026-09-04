import { Button, IconButton } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { AnimatePresence, motion } from "framer-motion";
import { LuExternalLink, LuX } from "react-icons/lu";
import type { TrainingVideo } from "~/utils/training";
import { getVideoEmbedUrl } from "~/utils/training";

type TrainingPanelProps = {
  training: TrainingVideo | null;
  isOpen: boolean;
  onDismiss: () => void;
};

export default function TrainingPanel({
  training,
  isOpen,
  onDismiss
}: TrainingPanelProps) {
  const { t } = useLingui();
  if (!training) return null;

  const embedUrl = getVideoEmbedUrl(training.videoUrl, training.videoType);

  return (
    <AnimatePresence mode="wait">
      {isOpen && (
        <motion.div
          key={training.title}
          initial={{ opacity: 0, y: 20, scale: 0.95, filter: "blur(4px)" }}
          animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: 10, scale: 0.95, filter: "blur(4px)" }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          className="fixed bottom-4 right-4 w-[380px] rounded-lg border bg-background shadow-lg z-40 overflow-hidden"
        >
          <div className="relative aspect-video w-full bg-muted">
            <iframe
              src={embedUrl}
              title={training.title}
              className="w-full h-full"
              allowFullScreen
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            />
            <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-background to-transparent pointer-events-none" />
            <IconButton
              aria-label={t`Close`}
              icon={<LuX />}
              variant="ghost"
              size="sm"
              className="absolute top-2 right-2 bg-background/80 backdrop-blur-sm hover:bg-background"
              onClick={onDismiss}
            />
          </div>

          <div className="px-4 pt-3.5 pb-5 space-y-1">
            <h3 className="text-sm font-semibold tracking-tight">
              {training.title}
            </h3>
            <p className="text-xs text-muted-foreground">
              {training.description}
            </p>
          </div>

          <div className="px-4 pb-3.5 flex items-center justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={onDismiss}>
              <Trans>Dismiss</Trans>
            </Button>
            {training.academyUrl ? (
              <Button
                size="sm"
                rightIcon={<LuExternalLink />}
                onClick={() => window.open(training.academyUrl, "_blank")}
              >
                <Trans>View in Academy</Trans>
              </Button>
            ) : (
              <Button
                size="sm"
                rightIcon={<LuExternalLink />}
                onClick={() => window.open(training.videoUrl, "_blank")}
              >
                <Trans>Watch full video</Trans>
              </Button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
