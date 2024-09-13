import { Card, CardContent, CardHeader, CardTitle } from "@carbon/react";
import { useParams } from "@remix-run/react";
import { RichText } from "~/components";
import { useRouteData } from "~/hooks";
import type { Note } from "~/modules/shared";
import { path } from "~/utils/path";

export default function ReceiptNotesRoute() {
  const { receiptId } = useParams();
  if (!receiptId) throw new Error("receiptId not found");
  const routeData = useRouteData<{ notes: Note[] }>(path.to.receipt(receiptId));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notes</CardTitle>
      </CardHeader>
      <CardContent>
        <RichText documentId={receiptId} notes={routeData?.notes ?? []} />
      </CardContent>
    </Card>
  );
}
