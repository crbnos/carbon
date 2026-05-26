import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { Card, CardContent, CardHeader, CardTitle } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useParams } from "react-router";
import RichText from "~/components/RichText";
import { getNotes } from "~/modules/shared/shared.service.server";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "people"
  });

  const { personId } = params;
  if (!personId) throw new Error("Could not find personId");

  const notes = await getNotes(personId);
  if (notes.error) {
    throw redirect(
      path.to.people,
      await flash(
        request,
        error(notes.error, "Failed to load public attributes")
      )
    );
  }

  return {
    notes: notes.data
  };
}

export default function PersonNotesRoute() {
  const { notes } = useLoaderData<typeof loader>();
  const { personId } = useParams();

  if (!personId) throw new Error("personId not found");

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Notes</Trans>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <RichText documentId={personId} notes={notes} />
      </CardContent>
    </Card>
  );
}
