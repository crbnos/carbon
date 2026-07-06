import { useRealtimeChannel } from "@carbon/react";
import { useState } from "react";
import { useUser } from "~/hooks";

/**
 * Watches the company's `documentTemplate` rows over realtime and flags when
 * *another* user saves the template currently open in the editor. Own writes
 * (matched by `updatedBy`) are ignored, so saving here — or editing in another
 * of your own tabs — never raises a false conflict.
 *
 * The editor does not auto-revalidate on the event (that would silently discard
 * in-progress edits); it surfaces a banner letting the user refresh or keep
 * their version.
 */
export function useTemplateConflict(documentType: string) {
  const { id: userId, company } = useUser();
  const [conflict, setConflict] = useState(false);

  useRealtimeChannel({
    topic: `document-template-conflict:${documentType}`,
    dependencies: [company.id, documentType, userId],
    setup(channel) {
      return channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "documentTemplate",
          filter: `companyId=eq.${company.id}`
        },
        (payload) => {
          const row = payload.new as
            | { documentType?: string; updatedBy?: string }
            | undefined;
          // Only this template, and only someone else's write.
          if (!row || row.documentType !== documentType) return;
          if (!row.updatedBy || row.updatedBy === userId) return;
          setConflict(true);
        }
      );
    }
  });

  return { conflict, dismiss: () => setConflict(false) };
}
