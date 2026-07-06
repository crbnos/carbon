import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import { getPickingListLine } from "~/modules/inventory";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "inventory"
  });

  const { pickingListId, lineId } = params;
  if (!pickingListId) throw new Error("pickingListId not found");
  if (!lineId) throw new Error("lineId not found");

  const pickingListLine = await getPickingListLine(client, lineId);

  if (pickingListLine.error) {
    throw redirect(
      path.to.pickingListDetails(pickingListId),
      await flash(
        request,
        error(pickingListLine.error, "Failed to load picking list line")
      )
    );
  }

  return { pickingListLine: pickingListLine.data };
}

export default function PickingListLineDetailRoute() {
  const params = useParams();
  const { pickingListId, lineId } = params;
  if (!pickingListId) throw new Error("pickingListId not found");
  if (!lineId) throw new Error("lineId not found");

  const { pickingListLine } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  if (!pickingListLine) return null;

  return (
    <div className="border rounded-lg p-6">
      <div className="flex flex-col gap-4">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-medium">
            {pickingListLine.item?.name ?? "Unknown Item"}
          </h3>
          <button
            type="button"
            className="text-sm text-muted-foreground hover:text-foreground"
            onClick={() => navigate(path.to.pickingListDetails(pickingListId))}
          >
            Back to Lines
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-muted-foreground">Item</span>
            <p className="font-medium">
              {pickingListLine.item?.readableId} - {pickingListLine.item?.name}
            </p>
          </div>
          <div>
            <span className="text-muted-foreground">Job</span>
            <p className="font-medium">{pickingListLine.job?.jobId ?? "N/A"}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Operation</span>
            <p className="font-medium">
              {pickingListLine.jobOperation?.process?.name ?? "N/A"} (Op{" "}
              {pickingListLine.jobOperation?.order ?? ""})
            </p>
          </div>
          <div>
            <span className="text-muted-foreground">Work Center</span>
            <p className="font-medium">
              {pickingListLine.jobOperation?.workCenter?.name ?? "N/A"}
            </p>
          </div>
          <div>
            <span className="text-muted-foreground">Qty to Pick</span>
            <p className="font-medium">
              {Number(pickingListLine.quantityToPick ?? 0).toLocaleString()}
            </p>
          </div>
          <div>
            <span className="text-muted-foreground">Qty Picked</span>
            <p className="font-medium">
              {Number(pickingListLine.quantityPicked ?? 0).toLocaleString()}
            </p>
          </div>
          <div>
            <span className="text-muted-foreground">Storage Unit</span>
            <p className="font-medium">
              {pickingListLine.storageUnit?.name ?? "N/A"}
            </p>
          </div>
          <div>
            <span className="text-muted-foreground">Status</span>
            <p className="font-medium">{pickingListLine.status ?? "Pending"}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
