// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbonFor } from "@carbon/api/carbon.server";
import { error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { updateSuggestionEmoji } from "~/modules/resources/resources.service";
import { SuggestionDetails } from "~/modules/resources/ui";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const auth = await requirePermissions(request, {
    view: "resources"
  });
  const api = carbonFor(auth);

  const { suggestionId } = params;
  if (!suggestionId) throw notFound("suggestionId was not found");

  const [suggestion, tags] = await Promise.all([
    api.resources.getSuggestion({ suggestionId }),
    api.shared.getTagsList({ table: "suggestion" })
  ]);

  if (suggestion.error) {
    throw redirect(
      path.to.suggestions,
      await flash(request, error(suggestion.error, "Failed to get suggestion"))
    );
  }

  return {
    suggestion: suggestion.data,
    tags: tags.data ?? []
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    update: "resources"
  });

  const { suggestionId } = params;
  if (!suggestionId) throw notFound("suggestionId was not found");

  const formData = await request.formData();
  const emoji = formData.get("emoji")?.toString();

  if (emoji) {
    const result = await updateSuggestionEmoji(client, suggestionId, emoji);
    if (result.error) {
      throw redirect(
        path.to.suggestion(suggestionId),
        await flash(request, error(result.error, "Failed to update emoji"))
      );
    }
  }

  return { success: true };
}

export default function SuggestionRoute() {
  const { suggestion, tags } = useLoaderData<typeof loader>();

  return <SuggestionDetails suggestion={suggestion} tags={tags} />;
}
