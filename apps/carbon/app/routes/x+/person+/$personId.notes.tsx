import { Card, CardContent, CardHeader, CardTitle } from "@carbon/react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useParams } from "@remix-run/react";

import { Notes, getNotes } from "~/modules/shared";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "people",
  });

  const { personId } = params;
  if (!personId) throw new Error("Could not find personId");

  const notes = await getNotes(client, personId);
  if (notes.error) {
    throw redirect(
      path.to.people,
      await flash(
        request,
        error(notes.error, "Failed to load public attributes")
      )
    );
  }

  return json({
    notes: notes.data,
  });
}

export default function PersonNotesRoute() {
  const { notes } = useLoaderData<typeof loader>();
  const { personId } = useParams();

  if (!personId) throw new Error("personId not found");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notes</CardTitle>
      </CardHeader>
      <CardContent>
        <Notes documentId={personId} notes={notes} />
      </CardContent>
    </Card>
  );
}
