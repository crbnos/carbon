import { IconButton } from "@carbon/react";
import posthog from "posthog-js";
import { useEffect, useState } from "react";
import { LuThumbsDown, LuThumbsUp } from "react-icons/lu";
import { useFetcher } from "react-router";
import { path } from "~/utils/path";

export function AgentFeedback({ threadId }: { threadId: string }) {
  const fetcher = useFetcher();
  const [submitted, setSubmitted] = useState<"up" | "down" | null>(null);
  const [dismissed, setDismissed] = useState(false);

  // Fade the "Feedback noted" confirmation after a couple seconds (copy-button style).
  useEffect(() => {
    if (!submitted) return;
    const t = setTimeout(() => setDismissed(true), 2500);
    return () => clearTimeout(t);
  }, [submitted]);

  function send(feedback: "up" | "down") {
    setSubmitted(feedback);
    posthog.capture("agent_feedback", { feedback });
    fetcher.submit(
      { threadId, feedback },
      { method: "post", action: path.to.api.agentFeedback }
    );
  }

  if (dismissed) return null;

  if (submitted) {
    return (
      <div className="mt-1 text-xs text-muted-foreground">Feedback noted</div>
    );
  }

  return (
    <div className="flex items-center gap-1 mt-1">
      <IconButton
        aria-label="Helpful"
        icon={<LuThumbsUp />}
        variant="ghost"
        size="sm"
        onClick={() => send("up")}
      />
      <IconButton
        aria-label="Not helpful"
        icon={<LuThumbsDown />}
        variant="ghost"
        size="sm"
        onClick={() => send("down")}
      />
    </div>
  );
}
