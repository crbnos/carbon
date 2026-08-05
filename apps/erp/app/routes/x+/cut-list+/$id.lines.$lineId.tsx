import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  data,
  redirect,
  useLoaderData,
  useNavigate,
  useParams
} from "react-router";
import {
  cutListLineValidator,
  getCutList,
  getCutListLines,
  upsertCutListLine
} from "~/modules/production";
import CutListLineForm from "~/modules/production/ui/CutLists/CutListLineForm";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "production",
    role: "employee"
  });

  const { id, lineId } = params;
  if (!id) throw notFound("id not found");
  if (!lineId) throw notFound("lineId not found");

  const [cutList, lines] = await Promise.all([
    getCutList(client, id, companyId),
    getCutListLines(client, id, companyId)
  ]);

  if (cutList.error || !cutList.data) {
    throw redirect(path.to.cutLists);
  }

  const line = (lines.data ?? []).find((l) => l.id === lineId);
  if (!line) throw notFound("line not found");

  return {
    line,
    unitOfDimension: cutList.data.unitOfDimension ?? "in"
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "production"
  });

  const { id, lineId } = params;
  if (!id) throw notFound("id not found");
  if (!lineId) throw notFound("lineId not found");

  const formData = await request.formData();
  const validation = await validator(cutListLineValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const updated = await upsertCutListLine(client, {
    ...validation.data,
    id: lineId,
    companyId,
    updatedBy: userId
  });

  if (updated.error) {
    return data(
      {},
      await flash(request, error(updated.error, "Failed to update piece"))
    );
  }

  throw redirect(
    path.to.cutList(id),
    await flash(request, success("Piece updated"))
  );
}

export default function EditCutListLineRoute() {
  const { line, unitOfDimension } = useLoaderData<typeof loader>();
  const { id } = useParams();
  const navigate = useNavigate();

  if (!id) throw notFound("id not found");

  return (
    <CutListLineForm
      initialValues={{
        id: line.id!,
        cutListId: id,
        jobId: line.jobId ?? undefined,
        jobMaterialId: line.jobMaterialId ?? undefined,
        itemId: line.itemId,
        pieceLength: Number(line.pieceLength),
        pieceWidth:
          line.pieceWidth === null ? undefined : Number(line.pieceWidth),
        quantity: line.quantity
      }}
      unitOfDimension={unitOfDimension}
      onClose={() => navigate(path.to.cutList(id))}
    />
  );
}
