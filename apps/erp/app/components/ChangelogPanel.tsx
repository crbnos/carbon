import { Badge, Button, IconButton } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { AnimatePresence, motion } from "framer-motion";
import { LuExternalLink, LuX } from "react-icons/lu";
import type { ChangelogPanelEntry } from "~/modules/account";

type ChangelogPanelProps = {
  entry: ChangelogPanelEntry | null;
  isOpen: boolean;
  onDismiss: () => void;
};

/**
 * Linear-style "What's new" card, shown bottom-right like the training panel:
 * NEW pill, the newest changelog entry's title and description, Dismiss, and a
 * link to the entry on docs.carbon.ms (the guid is its permalink).
 */
export default function ChangelogPanel({
  entry,
  isOpen,
  onDismiss
}: ChangelogPanelProps) {
  const { t } = useLingui();
  if (!entry) return null;

  return (
    <AnimatePresence mode="wait">
      {isOpen && (
        <motion.div
          key={entry.guid}
          initial={{ opacity: 0, y: 20, scale: 0.95, filter: "blur(4px)" }}
          animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: 10, scale: 0.95, filter: "blur(4px)" }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          className="fixed bottom-4 right-4 w-[380px] rounded-lg border bg-background shadow-lg z-40 overflow-hidden"
        >
          <div className="px-4 pt-4 pb-3 space-y-2">
            <div className="flex items-center justify-between">
              <Badge variant="blue" className="h-5 px-1.5 text-[10px]">
                <Trans>New</Trans>
              </Badge>
              <IconButton
                aria-label={t`Close`}
                icon={<LuX />}
                variant="ghost"
                size="sm"
                className="-mr-2 -mt-1"
                onClick={onDismiss}
              />
            </div>
            <h3 className="text-sm font-semibold tracking-tight">
              {entry.title}
            </h3>
            {entry.description && (
              <p className="text-xs text-muted-foreground">
                {entry.description}
              </p>
            )}
          </div>

          <div className="px-4 pb-3.5 flex items-center justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={onDismiss}>
              <Trans>Dismiss</Trans>
            </Button>
            <Button
              size="sm"
              rightIcon={<LuExternalLink />}
              onClick={() => window.open(entry.guid, "_blank")}
            >
              <Trans>Changelog</Trans>
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
