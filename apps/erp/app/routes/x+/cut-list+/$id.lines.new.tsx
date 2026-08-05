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
  upsertCutListLine
} from "~/modules/production";
import CutListLineForm from "~/modules/production/ui/CutLists/CutListLineForm";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    create: "production"
  });

  const { id } = params;
  if (!id) throw notFound("id not found");

  const cutList = await getCutList(client, id, companyId);
  if (cutList.error || !cutList.data) {
    throw redirect(path.to.cutLists);
  }

  return { unitOfDimension: cutList.data.unitOfDimension ?? "in" };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "production"
  });

  const { id } = params;
  if (!id) throw notFound("id not found");

  const formData = await request.formData();
  const validation = await validator(cutListLineValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  // The line id is create-only — a new piece has none yet.
  const { id: _lineId, ...d } = validation.data;

  const created = await upsertCutListLine(client, {
    ...d,
    cutListId: id,
    companyId,
    createdBy: userId
  });

  if (created.error) {
    return data(
      {},
      await flash(request, error(created.error, "Failed to add piece"))
    );
  }

  throw redirect(
    path.to.cutList(id),
    await flash(request, success("Piece added"))
  );
}

export default function NewCutListLineRoute() {
  const { unitOfDimension } = useLoaderData<typeof loader>();
  const { id } = useParams();
  const navigate = useNavigate();

  if (!id) throw notFound("id not found");

  return (
    <CutListLineForm
      initialValues={{
        cutListId: id,
        itemId: "",
        pieceLength: 0,
        quantity: 1
      }}
      unitOfDimension={unitOfDimension}
      onClose={() => navigate(path.to.cutList(id))}
    />
  );
}
