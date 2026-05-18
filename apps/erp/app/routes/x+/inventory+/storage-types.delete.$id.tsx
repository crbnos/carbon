import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  Button,
  Checkbox,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  redirect,
  useFetcher,
  useLoaderData,
  useNavigate,
  useParams
} from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import {
  deleteStorageTypeWithCascade,
  getStorageType,
  getStorageTypeUsage
} from "~/modules/inventory";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "parts"
  });
  const { id } = params;
  if (!id) throw notFound("id not found");

  const storageType = await getStorageType(id);
  if (storageType.error) {
    throw redirect(
      path.to.storageTypes,
      await flash(
        request,
        error(storageType.error, "Failed to get storage type")
      )
    );
  }

  const usage = await getStorageTypeUsage(id);

  return {
    storageType: storageType.data,
    usageCount: usage.count ?? 0,
    sampleUnits: usage.data ?? []
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  await requirePermissions(request, {
    delete: "parts"
  });

  const { id } = params;
  if (!id) {
    throw redirect(
      path.to.storageTypes,
      await flash(request, error(params, "Failed to get a storage type id"))
    );
  }

  const formData = await request.formData();
  const cascade = formData.get("cascade") === "true";

  const usage = await getStorageTypeUsage(id);
  const usageCount = usage.count ?? 0;

  if (usageCount > 0 && !cascade) {
    throw redirect(
      `${path.to.storageTypes}?${getParams(request)}`,
      await flash(
        request,
        error(
          { usageCount },
          "Storage type is in use; confirm cascade to delete"
        )
      )
    );
  }

  const { error: deleteTypeError } = await deleteStorageTypeWithCascade(id);
  if (deleteTypeError) {
    throw redirect(
      `${path.to.storageTypes}?${getParams(request)}`,
      await flash(
        request,
        error(deleteTypeError, "Failed to delete storage type")
      )
    );
  }

  throw redirect(
    path.to.storageTypes,
    await flash(request, success("Successfully deleted storage type"))
  );
}

export default function DeleteStorageTypeRoute() {
  const { id } = useParams();
  if (!id) throw new Error("id not found");

  const { storageType, usageCount, sampleUnits } =
    useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const { t } = useLingui();

  if (!storageType) return null;

  const onCancel = () => navigate(-1);

  if (usageCount === 0) {
    return (
      <ConfirmDelete
        action={path.to.deleteStorageType(id)}
        name={storageType.name}
        text={t`Are you sure you want to delete the storage type: ${storageType.name}? This cannot be undone.`}
        onCancel={onCancel}
      />
    );
  }

  return (
    <CascadeConfirmDelete
      action={path.to.deleteStorageType(id)}
      name={storageType.name}
      usageCount={usageCount}
      sampleUnits={sampleUnits}
      onCancel={onCancel}
    />
  );
}

type CascadeConfirmDeleteProps = {
  action: string;
  name: string;
  usageCount: number;
  sampleUnits: { id: string; name: string }[];
  onCancel: () => void;
};

function CascadeConfirmDelete({
  action,
  name,
  usageCount,
  sampleUnits,
  onCancel
}: CascadeConfirmDeleteProps) {
  const { t } = useLingui();
  const fetcher = useFetcher<{}>();
  const [cascade, setCascade] = useState(false);
  const remaining = usageCount - sampleUnits.length;

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>
          <ModalTitle>{t`Delete ${name}`}</ModalTitle>
        </ModalHeader>

        <ModalBody>
          <div className="flex flex-col gap-3 text-sm">
            <p className="text-muted-foreground">
              <Trans>
                This storage type is currently used by {usageCount} storage unit
                {usageCount === 1 ? "" : "s"}.
              </Trans>
            </p>
            {sampleUnits.length > 0 && (
              <ul className="list-disc pl-5 text-muted-foreground">
                {sampleUnits.map((u) => (
                  <li key={u.id}>{u.name}</li>
                ))}
                {remaining > 0 && (
                  <li>
                    <Trans>and {remaining} more</Trans>
                  </li>
                )}
              </ul>
            )}
            <fetcher.Form
              id="cascade-delete-form"
              method="post"
              action={action}
            >
              <label className="flex items-start gap-2 cursor-pointer">
                <Checkbox
                  name="cascade"
                  value="true"
                  isChecked={cascade}
                  onCheckedChange={(c) => setCascade(c === true)}
                  className="mt-0.5"
                />
                <span>
                  <Trans>
                    Remove this storage type from all referencing storage units
                    and delete it. This cannot be undone.
                  </Trans>
                </span>
              </label>
            </fetcher.Form>
          </div>
        </ModalBody>

        <ModalFooter>
          <Button variant="secondary" onClick={onCancel}>
            <Trans>Cancel</Trans>
          </Button>
          <Button
            variant="destructive"
            type="submit"
            form="cascade-delete-form"
            isDisabled={!cascade || fetcher.state !== "idle"}
            isLoading={fetcher.state !== "idle"}
          >
            <Trans>Delete</Trans>
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
