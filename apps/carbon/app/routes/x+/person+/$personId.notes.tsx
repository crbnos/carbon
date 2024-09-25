import { Card, CardContent, CardHeader, CardTitle } from "@carbon/react";
import { useLoaderData, useParams } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { RichText } from "~/components";

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getNotes } from "~/modules/shared";
import { path } from "~/utils/path";

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
        <RichText documentId={personId} notes={notes} />
      </CardContent>
    </Card>
  );
}
