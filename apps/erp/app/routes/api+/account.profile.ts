// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { AccountProfileData } from "@carbon/account";
import { accountProfileValidator } from "@carbon/account";
import { carbon } from "@carbon/api/carbon.server";
import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import { getAccount } from "~/modules/users/users.service";

const logger = getLogger("erp", "account-profile");

// Data and writes for the Profile pane of the account settings modal.
export async function loader({ request }: LoaderFunctionArgs) {
  const { client, userId } = await requirePermissions(request, {});
  const user = await getAccount(client, userId);

  if (user.error) {
    logger.error("Failed to get user", { userId, error: user.error });
  }

  return { user: user.data ?? null } satisfies AccountProfileData;
}

const profileForm = z.discriminatedUnion("intent", [
  accountProfileValidator.extend({ intent: z.literal("about") }),
  z.object({ intent: z.literal("photo"), path: z.string() })
]);

export async function action(args: ActionFunctionArgs) {
  const input = await validator(profileForm).request(args);
  if ("invalid" in input) return input.invalid;
  const form = input.data;

  const api = await carbon(args.request);
  if (form.intent === "photo") {
    return api.users.updateOwnAvatar({ path: form.path });
  }

  const { intent: _, ...profile } = form;
  const result = await api.users.updateOwnProfile(profile);
  return data(
    {},
    await flash(
      args.request,
      result.error
        ? error(null, result.error.message)
        : success("Updated profile")
    )
  );
}
