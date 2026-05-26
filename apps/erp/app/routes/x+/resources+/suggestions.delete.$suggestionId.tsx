import { assertIsPost, error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import {
  deleteSuggestion,
  getSuggestion
} from "~/modules/resources/resources.service.server";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    delete: "resources"
  });

  const { suggestionId } = params;
  if (!suggestionId) throw notFound("suggestionId was not found");

  const suggestion = await getSuggestion(suggestionId);

  if (suggestion.error) {
    throw redirect(
      path.to.suggestions,
      await flash(request, error(suggestion.error, "Failed to get suggestion"))
    );
  }

  return {
    suggestion: suggestion.data
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  await requirePermissions(request, {
    delete: "resources"
  });

  const { suggestionId } = params;
  if (!suggestionId) throw notFound("suggestionId was not found");

  const result = await deleteSuggestion(suggestionId);

  if (result.error) {
    throw redirect(
      path.to.suggestions,
      await flash(request, error(result.error, "Failed to delete suggestion"))
    );
  }

  throw redirect(path.to.suggestions);
}

export default function DeleteSuggestionRoute() {
  const { suggestion } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const { suggestionId } = useParams();

  const onClose = () => navigate(path.to.suggestions);

  const { t } = useLingui();
  return (
    <ConfirmDelete
      action={path.to.deleteSuggestion(suggestionId!)}
      name={`Suggestion: ${suggestion.suggestion?.slice(0, 50)}...`}
      text={t`Are you sure you want to delete this suggestion? This action cannot be undone.`}
      onCancel={onClose}
    />
  );
}
