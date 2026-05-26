import { error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { SuggestionDetails } from "~/modules/resources";
import {
  getSuggestion,
  updateSuggestionEmoji
} from "~/modules/resources/resources.service.server";
import { getTagsList } from "~/modules/shared/shared.service.server";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "resources"
  });

  const { suggestionId } = params;
  if (!suggestionId) throw notFound("suggestionId was not found");

  const [suggestion, tags] = await Promise.all([
    getSuggestion(suggestionId),
    getTagsList("suggestion")
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
  await requirePermissions(request, {
    update: "resources"
  });

  const { suggestionId } = params;
  if (!suggestionId) throw notFound("suggestionId was not found");

  const formData = await request.formData();
  const emoji = formData.get("emoji")?.toString();

  if (emoji) {
    const result = await updateSuggestionEmoji(suggestionId, emoji);
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
