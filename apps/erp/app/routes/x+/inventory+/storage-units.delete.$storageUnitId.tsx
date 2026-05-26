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
import { useEffect, useRef, useState } from "react";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs,
  LoaderFunctionArgs
} from "react-router";
import {
  redirect,
  useFetcher,
  useLoaderData,
  useNavigate,
  useParams
} from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import {
  deleteStorageUnit,
  deleteStorageUnitCascade,
  getStorageUnit
} from "~/modules/inventory/inventory.service.server";
import { getParams, path } from "~/utils/path";
import { getCompanyId } from "~/utils/react-query";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "inventory"
  });
  const { storageUnitId } = params;
  if (!storageUnitId) throw notFound("storageUnitId not found");

  // Fetch direct children by parentId. We need the actual row list (not
  // just a count) because the `.select(..., { count: "exact", head: true })`
  // combo was returning `count: null` in practice through this PostgREST
  // build, so the cascade modal never triggered. Fetching rows and reading
  // `.data.length` is unambiguous and the direct-child list is tiny.
  const [storageUnit, children] = await Promise.all([
    getStorageUnit(storageUnitId),
    client.from("storageUnit").select("id").eq("parentId", storageUnitId)
  ]);

  if (storageUnit.error) {
    throw redirect(
      path.to.storageUnits,
      await flash(
        request,
        error(storageUnit.error, "Failed to get storageUnit")
      )
    );
  }

  const childCount = children.data?.length ?? 0;

  return { storageUnit: storageUnit.data, childCount };
}

export async function action({ request, params }: ActionFunctionArgs) {
  await requirePermissions(request, {
    delete: "inventory"
  });

  const { storageUnitId } = params;
  if (!storageUnitId) {
    throw redirect(
      path.to.storageUnits,
      await flash(request, error(params, "Failed to get a storageUnit id"))
    );
  }

  const formData = await request.formData();
  const cascade = formData.get("cascade") === "true";

  const deleteResult = cascade
    ? await deleteStorageUnitCascade(storageUnitId)
    : await deleteStorageUnit(storageUnitId);

  if (deleteResult.error) {
    throw redirect(
      path.to.storageUnits,
      await flash(
        request,
        error(deleteResult.error, "Failed to delete storage unit")
      )
    );
  }

  throw redirect(
    `${path.to.storageUnits}?${getParams(request)}`,
    await flash(
      request,
      success(
        cascade
          ? "Successfully deleted storage unit and nested units"
          : "Successfully deleted storage unit"
      )
    )
  );
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  // Nothing to validate — ConfirmDelete-style forms only carry the cascade
  // flag. Invalidate the cached list so the table refreshes after.
  const companyId = getCompanyId();
  window.clientCache?.invalidateQueries({
    predicate: (query) => {
      const queryKey = query.queryKey as string[];
      return queryKey[0] === "storageUnits" && queryKey[1] === companyId;
    }
  });
  return await serverAction();
}

export default function DeleteStorageUnitRoute() {
  const { storageUnitId } = useParams();
  if (!storageUnitId) throw notFound("storageUnitId not found");

  const { storageUnit, childCount } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const { t } = useLingui();

  if (!storageUnit) return null;
  const onCancel = () => navigate(path.to.storageUnits);

  // When the unit has no children, reuse the standard ConfirmDelete — it
  // posts nothing special and the server path goes through the non-cascade
  // branch.
  if (childCount === 0) {
    return (
      <ConfirmDelete
        action={path.to.deleteStorageUnit(storageUnitId)}
        name={storageUnit.name}
        text={t`Are you sure you want to delete the storage unit: ${storageUnit.name}? This cannot be undone.`}
        onCancel={onCancel}
      />
    );
  }

  return (
    <DeleteWithCascadeModal
      storageUnitId={storageUnitId}
      storageUnitName={storageUnit.name}
      childCount={childCount}
      onCancel={onCancel}
    />
  );
}

function DeleteWithCascadeModal({
  storageUnitId,
  storageUnitName,
  childCount,
  onCancel
}: {
  storageUnitId: string;
  storageUnitName: string;
  childCount: number;
  onCancel: () => void;
}) {
  const { t } = useLingui();
  const fetcher = useFetcher<{}>();
  const [cascade, setCascade] = useState(false);
  const submitted = useRef(false);

  useEffect(() => {
    if (fetcher.state === "idle" && submitted.current) {
      submitted.current = false;
    }
  }, [fetcher.state]);

  const disabled = !cascade;

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
          <ModalTitle>{t`Delete ${storageUnitName}`}</ModalTitle>
        </ModalHeader>

        <ModalBody>
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              {childCount === 1
                ? t`"${storageUnitName}" has 1 direct nested storage unit. Deleting it will also delete that unit and anything underneath it. This cannot be undone.`
                : t`"${storageUnitName}" has ${childCount} direct nested storage units. Deleting it will also delete them and anything underneath them. This cannot be undone.`}
            </p>
            <label className="flex items-start gap-2 bg-muted/20 pt-3 text-sm">
              <Checkbox
                isChecked={cascade}
                onCheckedChange={(v) => setCascade(v === true)}
                className="mt-0.5"
              />
              <span className="leading-snug">
                <Trans>Yes, also delete every nested storage unit.</Trans>
              </span>
            </label>
          </div>
        </ModalBody>

        <ModalFooter>
          <Button variant="secondary" onClick={onCancel}>
            <Trans>Cancel</Trans>
          </Button>
          <fetcher.Form
            method="post"
            action={path.to.deleteStorageUnit(storageUnitId)}
            onSubmit={() => (submitted.current = true)}
          >
            <input type="hidden" name="cascade" value="true" />
            <Button
              type="submit"
              variant="destructive"
              isDisabled={disabled || fetcher.state !== "idle"}
              isLoading={fetcher.state !== "idle"}
            >
              <Trans>Delete</Trans>
            </Button>
          </fetcher.Form>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
