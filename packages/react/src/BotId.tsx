import { initBotId } from "botid/client/core";
import { useEffect } from "react";

let initialized = false;

// Vercel BotID: patches window.fetch so POSTs to `path` carry an invisible
// challenge that checkBotId() verifies on the server. React Router submits an
// action to `${path}.data`, so both forms are protected. Pass the server's
// `botIdEnabled` — off Vercel the challenge script 404s and the patched fetch
// would reject every submission.
export function useBotIdProtection(path: string, enabled: boolean) {
  useEffect(() => {
    if (!enabled || initialized) return;
    initialized = true;
    initBotId({
      protect: [
        { path, method: "POST" },
        { path: `${path}.data`, method: "POST" }
      ]
    });
  }, [path, enabled]);
}
