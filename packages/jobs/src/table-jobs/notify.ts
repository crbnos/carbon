// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { trigger } from "@carbon/lib/trigger";
import {
  NotificationDestination,
  type NotificationEvent
} from "@carbon/notifications";

/**
 * Tells the user who asked for a table job how it went. `dedupeId` is the
 * Inngest event id: a step that sends and then fails before it returns is
 * retried, and the retry sends the same id, which Inngest drops for 24 h.
 */
export async function notifyTableJobUser(args: {
  event: NotificationEvent.TableExport | NotificationEvent.TableBulkAction;
  companyId: string;
  userId: string;
  documentId: string;
  title: string;
  body?: string;
  inAppOnly?: boolean;
  dedupeId: string;
}): Promise<void> {
  // Never `from`: notify drops the sender from the recipients, and the
  // sender here would be the recipient.
  await trigger(
    "notify",
    {
      event: args.event,
      companyId: args.companyId,
      documentId: args.documentId,
      title: args.title,
      ...(args.body ? { body: args.body } : {}),
      recipient: { type: "user", userId: args.userId },
      ...(args.inAppOnly
        ? { destinations: [NotificationDestination.InApp] }
        : {})
    },
    { id: args.dedupeId }
  );
}
