import { useCarbon } from "@carbon/auth";
import { ValidatedForm } from "@carbon/form";
import {
  Button,
  cn,
  HStack,
  Loading,
  ModalCard,
  ModalCardBody,
  ModalCardContent,
  ModalCardDescription,
  ModalCardFooter,
  ModalCardHeader,
  ModalCardProvider,
  ModalCardTitle,
  toast,
  VStack
} from "@carbon/react";
import {
  convertKbToString,
  getFileSizeLimit,
  INPUT_FORMAT,
  supportedModelTypes
} from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { PostgrestResponse } from "@supabase/supabase-js";
import { nanoid } from "nanoid";
import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { useDropzone } from "react-dropzone";
import { LuCloudUpload } from "react-icons/lu";
import { useFetcher, useNavigate } from "react-router";
import type { z } from "zod";
import { TrackingTypeIcon } from "~/components";
import {
  CustomFormFields,
  DefaultMethodType,
  Hidden,
  Input,
  InputControlled,
  ItemPostingGroup,
  Number,
  Select,
  SelectControlled,
  Submit,
  TextArea,
  UnitOfMeasure
} from "~/components/Form";
import { ReplenishmentSystemIcon } from "~/components/Icons";
import { ModelUploadProgress } from "~/components/ModelUploadProgress";
import { OnshapeImportProgress } from "~/components/OnshapeImportProgress";
import type { OnshapeRevision as OnshapeSelection } from "~/components/OnshapeRevisionSearch";
import { OnshapeRevisionSearch } from "~/components/OnshapeRevisionSearch";
import {
  useCurrencyDecimals,
  useModelUpload,
  useNextItemId,
  usePermissions,
  useUser
} from "~/hooks";
import { useItemSources } from "~/hooks/useItemSources";
import type { loader as replenishmentLoader } from "~/routes/api+/integrations.onshape.replenishment";
import { path } from "~/utils/path";
import {
  itemReplenishmentSystems,
  itemTrackingTypes,
  partValidator
} from "../../items.models";
import ItemStorageFields from "../Item/ItemStorageFields";
import { bomOptionState, seedFromElementType } from "./onshapePartSource";

/**
 * The two shapes an action can answer this form with.
 *
 * The ordinary new-part action returns a PostgrestResponse; `v2.create` returns
 * `{ success, itemId, message }`. The three inline-create callers
 * (`components/Form/Part.tsx`, `Item.tsx`, `Items.tsx`) read `data.data.id` off
 * the first shape, which is why the Onshape source is behind an explicit prop
 * rather than inferred from `type === "card"`.
 */
type PartFormActionData =
  | PostgrestResponse<{ id: string }>
  | {
      success: boolean;
      itemId?: string;
      /** Onshape's own part number, as the route verified it. */
      readableId?: string;
      revision?: string;
      message?: string;
      /** Something the user must be shown — see the create route. */
      notice?: string | null;
      importQueued?: boolean;
    };

type PartFormProps = {
  initialValues: z.infer<typeof partValidator> & { tags?: string[] };
  type?: "card" | "modal";
  onClose?: () => void;
  /**
   * Offer the company's connected item sources (Onshape, and whatever joins
   * `useItemSources` after it) as a way to seed this part.
   *
   * Opt-in, never inferred: the inline-create callers above submit to the
   * ordinary action and read a PostgrestResponse back, and would silently break
   * if this form could ever redirect them somewhere else.
   */
  withItemSources?: boolean;
  /** Open this source's picker on mount, when the company has it connected. */
  defaultSourceId?: string | null;
};

const SIZE_LIMIT = getFileSizeLimit("CAD_MODEL_UPLOAD");

function startsWithLetter(value: string) {
  return /^[A-Za-z]/.test(value);
}

function isPostgrestResponse(
  data: PartFormActionData
): data is PostgrestResponse<{ id: string }> {
  return !("success" in data);
}

const PartForm = ({
  initialValues,
  type = "card",
  onClose,
  withItemSources = false,
  defaultSourceId = null
}: PartFormProps) => {
  const { t } = useLingui();
  const { company } = useUser();
  const navigate = useNavigate();
  const baseCurrency = company?.baseCurrencyCode ?? "USD";
  const currencyDecimals = useCurrencyDecimals(baseCurrency);

  const fetcher = useFetcher<PartFormActionData>();

  const [modelUploadId, setModelUploadId] = useState<string | null>(null);
  const [modelIsUploading, setModelIsUploading] = useState(false);
  const [modelFile, setModelFile] = useState<File | null>(null);
  const { carbon } = useCarbon();
  const { upload, runUpload } = useModelUpload();
  const {
    company: { id: companyId }
  } = useUser();

  const isEditing = !!initialValues.id;
  const permissions = usePermissions();
  const connectedSources = useItemSources();

  // Presentation only. Every source's create route re-reads the connection
  // server-side and refuses when the company has none, so an empty list hiding
  // the picker is never what keeps a source off a company that never connected.
  const sources = withItemSources && !isEditing ? connectedSources : [];

  // `null` is the blank part — the state the form is in before anyone picks a
  // source, and the state a second click on the picked wordmark returns to.
  //
  // Seeded from `sources`, NOT from `connectedSources`: a form that is editing,
  // or one whose caller never opted in, has no picker to show, and seeding a
  // source it cannot display would leave it silently in a state the user has no
  // control to leave.
  const [source, setSource] = useState<string | null>(() =>
    sources.some((s) => s.id === defaultSourceId) ? defaultSourceId : null
  );
  const [selection, setSelection] = useState<OnshapeSelection | null>(null);
  /**
   * Where the Buy/Make on screen came from, so the form can SAY so.
   *
   * `null` while the lookup is in flight. "purchasing-level" means Onshape's
   * own column answered; "structure" means Carbon inferred it from the element
   * type, which is a guess and is labelled as one.
   */
  const [replenishmentSource, setReplenishmentSource] = useState<
    "purchasing-level" | "structure" | null
  >(null);
  const replenishmentFetcher = useFetcher<typeof replenishmentLoader>();

  // Both halves, not just the id: `source` can only hold a source the picker
  // offers, and the picker is gated, but the invariant is cheap to state and
  // expensive to rediscover.
  const isFromOnshape = sources.length > 0 && source === "onshape";
  const hasOnshapeSelection = isFromOnshape && selection !== null;

  const modelUpload = async (file: File) => {
    if (!carbon) return;
    flushSync(() => {
      setModelIsUploading(true);
    });

    const modelId = nanoid();
    const fileExtension = file.name.split(".").pop();
    const fileName = `${companyId}/models/${modelId}.${fileExtension}`;

    // Resumable (TUS) upload — a standard buffered upload times out on multi-GB
    // CAD files. Runs in parallel with the record insert.
    const [{ error: uploadError }, recordInsert] = await Promise.all([
      runUpload({ bucket: "temp-staging", path: fileName, file }),
      carbon.from("modelUpload").insert({
        id: modelId,
        modelPath: fileName,
        size: file.size,
        name: file.name,
        companyId: companyId,
        createdBy: "system"
      })
    ]);

    if (uploadError || recordInsert.error) {
      toast.error(t`Failed to upload model`);
    } else {
      setModelUploadId(modelId);
      setModelFile(file);
      toast.success(t`Uploaded model`);
    }

    setModelIsUploading(false);
  };

  const removeModel = () => {
    setModelUploadId(null);
    setModelFile(null);
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    multiple: false,
    maxSize: SIZE_LIMIT.bytes,
    onDropAccepted: async (acceptedFiles) => {
      const file = acceptedFiles[0];

      const fileExtension = file.name.split(".").pop()?.toLowerCase();
      if (!fileExtension || !supportedModelTypes.includes(fileExtension)) {
        toast.error(t`File type not supported`);

        return;
      }

      if (file.size > SIZE_LIMIT.bytes) {
        toast.error(t`File size too big (max. ${SIZE_LIMIT.format()})`);
        return;
      }

      await modelUpload(file);
    },
    onDropRejected: (fileRejections) => {
      const { errors } = fileRejections[0];
      let message;
      if (errors[0].code === "file-too-large") {
        message = t`File size too big (max. ${SIZE_LIMIT.format()})`;
      } else if (errors[0].code === "file-invalid-type") {
        message = t`File type not supported`;
      } else {
        message = errors[0].message;
      }
      toast.error(message);
    }
  });

  useEffect(() => {
    if (!fetcher.data) return;

    // `v2.create` answers with its own shape, not a PostgrestResponse, and it
    // answers on the page flow as well as the modal one — so this branch cannot
    // sit behind the `type === "modal"` guard below.
    if (!isPostgrestResponse(fetcher.data)) {
      if (fetcher.state !== "idle") return;
      const result = fetcher.data;
      if (result.success && result.itemId) {
        // No toast and no navigation. The modal switches to the progress panel
        // and waits — the whole point is that the part the user lands on is
        // finished, and a success toast fired now would be reporting on work
        // that has not happened yet.
        setPendingImport({
          itemId: result.itemId,
          partNumber: result.readableId ?? selection?.partNumber ?? "",
          revision: result.revision ?? selection?.revision ?? "",
          isBody: (selection?.partId ?? null) !== null,
          notice: result.notice ?? null
        });
      } else if (!result.success) {
        toast.error(result.message ?? t`Could not create the part`);
      }
      return;
    }

    if (type !== "modal") return;

    if (fetcher.state === "loading" && fetcher.data.data) {
      onClose?.();
      toast.success(t`Created part`);
    } else if (fetcher.state === "idle" && fetcher.data.error) {
      toast.error(t`Failed to create part: ${fetcher.data.error.message}`);
    }
  }, [fetcher.data, fetcher.state, onClose, type, t, selection]);

  const { id, onIdChange, loading } = useNextItemId("Part");

  const translateItemTrackingType = (v: string) =>
    v === "Inventory"
      ? t`Inventory`
      : v === "Non-Inventory"
        ? t`Non-Inventory`
        : v === "Serial"
          ? t`Serial`
          : t`Batch`;

  const itemTrackingTypeOptions = itemTrackingTypes.map((itemTrackingType) => ({
    label: (
      <span className="flex items-center gap-2">
        <TrackingTypeIcon type={itemTrackingType} />
        {translateItemTrackingType(itemTrackingType)}
      </span>
    ),
    value: itemTrackingType
  }));

  const [replenishmentSystem, setReplenishmentSystem] = useState<string>(
    initialValues.replenishmentSystem ?? "Buy"
  );
  const [defaultMethodType, setDefaultMethodType] = useState<string>(
    initialValues.defaultMethodType ?? "Pull from Inventory"
  );
  // Controlled ONLY so an Onshape selection can seed it — an uncontrolled
  // `Input` reads the form's defaultValues once and a pick made after mount
  // never reaches it. Editable thereafter: nothing in the Onshape path resolves
  // on an item's name.
  const [name, setName] = useState<string>(initialValues.name ?? "");
  /**
   * The part that was just created, while Carbon is still building it out.
   *
   * Set instead of navigating. The create route answers as soon as the ITEM
   * exists; its bill of materials, models and drawings land in a job seconds to
   * minutes later, so navigating on that response drops the user onto a part
   * with no structure and no geometry — which reads as a broken import rather
   * than an unfinished one.
   */
  const [pendingImport, setPendingImport] = useState<{
    itemId: string;
    partNumber: string;
    revision: string;
    isBody: boolean;
    notice: string | null;
  } | null>(null);
  const itemReplenishmentSystemOptions =
    itemReplenishmentSystems.map((itemReplenishmentSystem) => ({
      label: (
        <span className="flex items-center gap-2">
          <ReplenishmentSystemIcon type={itemReplenishmentSystem} />
          {itemReplenishmentSystem === "Buy"
            ? t`Buy`
            : itemReplenishmentSystem === "Make"
              ? t`Make`
              : t`Buy and Make`}
        </span>
      ),
      value: itemReplenishmentSystem
    })) ?? [];

  /**
   * Whether this selection's bill of materials will be imported.
   *
   * No longer a choice. Someone who picked an Onshape assembly has already said
   * the part comes from Onshape, and its structure is the expected outcome
   * rather than an opt-in — importing the geometry and leaving the BOM behind
   * was always the surprising half. What remains are the two cases where it
   * CANNOT happen, and both are stated on the form rather than silently
   * dropping the structure: a Part Studio body has no bill of materials, and
   * the import mints parts and deletes material lines, so it needs update and
   * delete on parts where creating needs only create.
   */
  const bomOption = selection
    ? bomOptionState({
        elementType: selection.elementType,
        canCreate: permissions.can("create", "parts"),
        canUpdate: permissions.can("update", "parts"),
        canDelete: permissions.can("delete", "parts")
      })
    : { offered: false, disabled: true, reason: null };

  const importBom = bomOption.offered && !bomOption.disabled;

  const onOnshapeSelect = (revision: OnshapeSelection) => {
    setSelection(revision);

    // Seed IMMEDIATELY from the element's shape so the fields are never blank,
    // then ask Onshape whether it has a better answer. `seedFromElementType` is
    // the same structural rule `resolveOnshapeReplenishment` falls back to, so
    // the optimistic value and the confirmed one agree whenever the company has
    // no Purchasing Level column — which is most of them.
    const seed = seedFromElementType(revision.elementType);
    setReplenishmentSystem(seed.replenishmentSystem);
    setDefaultMethodType(seed.defaultMethodType);
    setReplenishmentSource(null);
    setName(revision.name ?? revision.partNumber);

    const params = new URLSearchParams({
      did: revision.documentId,
      vid: revision.versionId,
      eid: revision.elementId,
      type: String(revision.elementType)
    });
    if (revision.partId) params.set("pid", revision.partId);
    replenishmentFetcher.load(
      `${path.to.api.onShapeReplenishment}?${params.toString()}`
    );
  };

  /**
   * Pick a source, or un-pick the picked one.
   *
   * Every switch drops the selection: a revision chosen in one system means
   * nothing in the next, and carrying it across would leave the form claiming a
   * part number no longer backed by anything.
   */
  const onSelectSource = (id: string) => {
    setSelection(null);
    setReplenishmentSource(null);
    setSource((current) => (current === id ? null : id));
  };

  /**
   * Apply what Onshape said, once it answers.
   *
   * Keyed on the fetcher's data rather than on the selection: the request is
   * fired by the click handler above, and this is the only place its result can
   * land. A BOM import overrides the answer regardless — see the effect below.
   */
  useEffect(() => {
    const resolved = replenishmentFetcher.data?.data;
    if (!resolved) return;
    setReplenishmentSystem(resolved.replenishmentSystem);
    setDefaultMethodType(resolved.defaultMethodType);
    setReplenishmentSource(resolved.source);
  }, [replenishmentFetcher.data]);

  /**
   * A BOM under a Buy part is a trap, not a preference.
   *
   * `methodMaterial.methodType` is denormalized from the component's
   * `defaultMethodType`, and `get_method_tree` only resolves a sub-method for
   * "Pull from Inventory" or an explicit `materialMakeMethodId` — so a Buy
   * parent would own a sub-tree that never explodes. When the structure IS
   * being imported the two fields are forced and locked, and the form says why.
   */
  useEffect(() => {
    if (!importBom) return;
    setReplenishmentSystem("Make");
    setDefaultMethodType("Make to Order");
  }, [importBom]);

  /**
   * What Onshape OWNS on a created part, and therefore what the form freezes.
   *
   * Exactly two fields, and only because something downstream breaks otherwise:
   *
   *  - REVISION. `selectReleaseTarget` matches Onshape's revision letter against
   *    `item.revision`, `releaseKey` maps Onshape's number/revision 1:1 onto
   *    `readableIdWithRevision`, and `item_unique` is on the raw revision
   *    column. A hand-edited revision means the next release of that letter does
   *    not find this item and either refuses or starts a second family.
   *  - PART ID. The link itself would survive a divergence — resolution is by
   *    element mapping — but the release job probes `readableId` against the
   *    released part number before auto-creating, refuses a family whose members
   *    carry different numbers, and `resolveOnshapeRevision` verifies the number
   *    the user did not type.
   *
   * Short Description is NOT frozen, and used to be. Nothing resolves on it and
   * neither job ever writes it back — the only two reads of `name` anywhere in
   * the Onshape path are a message string and a different table's column. It is
   * seeded from Onshape and then it is the user's, like every other field here.
   */
  const identityLocked = hasOnshapeSelection;

  // The part exists; Carbon is still filling it in. The form is REPLACED rather
  // than overlaid — there is nothing left to edit here, and leaving the fields
  // behind a spinner invites someone to change one and expect it to matter.
  if (pendingImport) {
    return (
      <ModalCardProvider type={type}>
        <ModalCard onClose={onClose}>
          <ModalCardContent>
            <ModalCardHeader>
              <ModalCardTitle>
                <Trans>Creating the part from Onshape</Trans>
              </ModalCardTitle>
            </ModalCardHeader>
            <ModalCardBody>
              <OnshapeImportProgress
                itemId={pendingImport.itemId}
                partNumber={pendingImport.partNumber}
                revision={pendingImport.revision}
                isBody={pendingImport.isBody}
                notice={pendingImport.notice}
                onDone={() => navigate(path.to.part(pendingImport.itemId))}
              />
            </ModalCardBody>
          </ModalCardContent>
        </ModalCard>
      </ModalCardProvider>
    );
  }

  return (
    <ModalCardProvider type={type}>
      <ModalCard onClose={onClose}>
        <ModalCardContent>
          <ValidatedForm
            action={
              identityLocked
                ? path.to.api.onShapeCreate
                : isEditing
                  ? undefined
                  : path.to.newPart
            }
            method="post"
            validator={partValidator}
            defaultValues={initialValues}
            fetcher={fetcher}
          >
            <ModalCardHeader>
              <ModalCardTitle>
                {isEditing ? (
                  <Trans>Part Details</Trans>
                ) : (
                  <Trans>New Part</Trans>
                )}
              </ModalCardTitle>
              {!isEditing && (
                <ModalCardDescription>
                  <Trans>
                    A part contains the information about a specific item that
                    can be purchased or manufactured.
                  </Trans>
                </ModalCardDescription>
              )}
            </ModalCardHeader>
            <ModalCardBody>
              <Hidden name="type" value={type} />
              <Hidden name="modelUploadId" value={modelUploadId ?? ""} />
              {!isEditing && replenishmentSystem === "Make" && (
                <Hidden name="unitCost" value={initialValues.unitCost} />
              )}
              {!isEditing && replenishmentSystem === "Buy" && (
                <Hidden name="lotSize" value={initialValues.lotSize} />
              )}
              {hasOnshapeSelection && selection && (
                <>
                  {/* Identity, for the server to re-resolve against Onshape.
                      `revision` is NOT repeated here — the read-only input
                      below carries it, and two entries under one name would
                      arrive as an array. */}
                  <Hidden name="partNumber" value={selection.partNumber} />
                  <Hidden
                    name="elementType"
                    value={String(selection.elementType)}
                  />
                  <Hidden name="documentId" value={selection.documentId} />
                  <Hidden name="versionId" value={selection.versionId} />
                  <Hidden name="elementId" value={selection.elementId} />
                  <Hidden name="partId" value={selection.partId ?? ""} />
                  <Hidden
                    name="revisionId"
                    value={selection.revisionId ?? ""}
                  />
                </>
              )}

              {sources.length > 0 && (
                <div className="mb-4 w-full rounded-md border border-border p-3">
                  <VStack spacing={2}>
                    <span className="text-xs font-medium text-muted-foreground">
                      <Trans>Create from</Trans>
                    </span>
                    <HStack spacing={2} className="flex-wrap">
                      {sources.map(({ id, name, Wordmark }) => (
                        <Button
                          key={id}
                          type="button"
                          size="sm"
                          variant={source === id ? "primary" : "secondary"}
                          aria-pressed={source === id}
                          aria-label={name}
                          onClick={() => onSelectSource(id)}
                        >
                          <Wordmark className="h-3.5 w-auto" />
                        </Button>
                      ))}
                    </HStack>

                    {isFromOnshape && selection && (
                      <HStack className="w-full items-center justify-between gap-2">
                        <p className="min-w-0 text-sm">
                          <span className="font-medium">
                            {selection.partNumber}
                          </span>{" "}
                          <span className="text-muted-foreground">
                            {selection.revision}
                            {selection.name ? ` · ${selection.name}` : ""}
                          </span>
                        </p>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => setSelection(null)}
                        >
                          <Trans>Change</Trans>
                        </Button>
                      </HStack>
                    )}

                    {/* The search lives HERE rather than in a second modal.
                        Stacking a dialog on top of the one being filled in, to
                        choose one value, hid the form behind it — and the form
                        is what the user came for. */}
                    {isFromOnshape && !selection && (
                      <div className="w-full min-w-0 pt-1">
                        <OnshapeRevisionSearch
                          isActive={isFromOnshape}
                          selected={null}
                          onSelect={onOnshapeSelect}
                          hideLinked
                          maxHeightClassName="max-h-[260px]"
                        />
                      </div>
                    )}

                    {hasOnshapeSelection && (
                      <p className="w-full text-xs text-muted-foreground">
                        <Trans>
                          The part number and revision come from Onshape and
                          cannot be edited — they are what future releases of
                          this part are matched on. Everything else is yours.
                        </Trans>
                      </p>
                    )}
                  </VStack>
                </div>
              )}

              <div
                className={cn(
                  "grid w-full gap-x-8 gap-y-4",
                  isEditing
                    ? "grid-cols-1 md:grid-cols-3"
                    : "grid-cols-1 md:grid-cols-2"
                )}
              >
                {isEditing ? (
                  <Input name="id" label={t`Part ID`} isReadOnly />
                ) : identityLocked && selection ? (
                  // isReadOnly, NOT isDisabled: a disabled input submits
                  // nothing, and `partValidator` would then fail on id/revision/
                  // name before the request was ever made.
                  //
                  // And no isUppercase: uppercasing a controlled value is
                  // exactly the defect the Onshape source exists to fix — a
                  // lowercase Onshape part number the form cannot express.
                  <InputControlled
                    name="id"
                    label={t`Part ID`}
                    value={selection.partNumber}
                    isReadOnly
                  />
                ) : (
                  <InputControlled
                    name="id"
                    label={t`Part ID`}
                    helperText={
                      startsWithLetter(id)
                        ? t`Use ... to get the next part ID`
                        : undefined
                    }
                    value={id}
                    onChange={onIdChange}
                    isDisabled={loading}
                    isUppercase
                  />
                )}
                {identityLocked && selection ? (
                  // `Input` is uncontrolled off the form's defaultValues, so a
                  // selection made after mount cannot reach it.
                  <InputControlled
                    name="revision"
                    label={t`Revision`}
                    value={selection.revision}
                    isReadOnly
                  />
                ) : (
                  <Input
                    name="revision"
                    label={t`Revision`}
                    isReadOnly={isEditing}
                  />
                )}

                {identityLocked && selection ? (
                  // SEEDED from Onshape, not frozen to it. `InputControlled` so
                  // a selection made after mount reaches the field at all —
                  // `Input` is uncontrolled off the form's defaultValues — and
                  // `key` so a NEW selection re-seeds it rather than leaving the
                  // previous part's description behind.
                  <InputControlled
                    key={selection.externalId}
                    name="name"
                    label={t`Short Description`}
                    value={name}
                    onChange={setName}
                    characterLimit={40}
                  />
                ) : (
                  <Input
                    name="name"
                    label={t`Short Description`}
                    characterLimit={40}
                  />
                )}

                <SelectControlled
                  name="replenishmentSystem"
                  label={t`Replenishment System`}
                  termId="replenishment-system"
                  options={itemReplenishmentSystemOptions}
                  value={replenishmentSystem}
                  // Read-only ONLY while a bill of materials is being imported,
                  // and never because the part came from Onshape. Onshape SEEDS
                  // this (see the helper text below); it does not own it.
                  isReadOnly={importBom}
                  helperText={
                    replenishmentSource === "purchasing-level"
                      ? t`From this part's Purchasing Level in Onshape.`
                      : replenishmentSource === "structure"
                        ? t`Carbon's guess — Onshape does not say. Change it if it is wrong.`
                        : undefined
                  }
                  onChange={(newValue) => {
                    setReplenishmentSystem(newValue?.value ?? "Buy");
                    // A deliberate edit is no longer Onshape's answer, and the
                    // helper text must stop claiming it is.
                    setReplenishmentSource(null);
                    if (newValue?.value === "Buy") {
                      setDefaultMethodType("Pull from Inventory");
                    } else {
                      setDefaultMethodType("Make to Order");
                    }
                  }}
                />
                <Select
                  name="itemTrackingType"
                  label={t`Tracking Type`}
                  termId="item-tracking-type"
                  options={itemTrackingTypeOptions}
                />
                <DefaultMethodType
                  name="defaultMethodType"
                  label={t`Default Method Type`}
                  termId="item-default-method-type"
                  replenishmentSystem={replenishmentSystem}
                  value={defaultMethodType}
                  isReadOnly={importBom}
                  onChange={(newValue) =>
                    setDefaultMethodType(
                      newValue?.value ?? "Pull from Inventory"
                    )
                  }
                />
                <UnitOfMeasure
                  name="unitOfMeasureCode"
                  label={t`Unit of Measure`}
                />
                {!isEditing && (
                  <ItemPostingGroup
                    name="postingGroupId"
                    label={t`Item Group`}
                    termId="item-group"
                    isClearable
                  />
                )}
                {!isEditing && replenishmentSystem !== "Make" && (
                  <Number
                    name="unitCost"
                    label={t`Unit Cost`}
                    formatOptions={INPUT_FORMAT.rate(
                      baseCurrency,
                      currencyDecimals
                    )}
                    minValue={0}
                  />
                )}
                {!isEditing && replenishmentSystem !== "Buy" && (
                  <Number
                    name="lotSize"
                    label={t`Batch Size`}
                    minValue={0}
                    termId="part-batch-size"
                  />
                )}

                <ItemStorageFields />

                <CustomFormFields table="part" tags={initialValues.tags} />
              </div>

              {hasOnshapeSelection && bomOption.offered && (
                <div className="mt-4 w-full rounded-md border border-border p-3">
                  <p className="text-sm font-medium">
                    <Trans>Carbon will import the bill of materials</Trans>
                  </p>
                  {bomOption.disabled ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      <Trans>
                        — or it would, but importing one creates and deletes
                        parts, so it needs update and delete permission on
                        parts. The part itself is still created, with its model.
                      </Trans>
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-muted-foreground">
                      <Trans>
                        This assembly's structure is read from Onshape and
                        written into the part's draft method, along with the
                        models and drawings for every part in it. Replenishment
                        is set to Make / Make to Order because a bill of
                        materials only explodes under a Make part.
                      </Trans>
                    </p>
                  )}
                </div>
              )}

              <div className="mt-4 w-full">
                <TextArea name="description" label={t`Long Description`} />
              </div>
              {/* The dropzone is hidden under an Onshape selection:
                  `attachOnshapeAssetsToItem` compare-and-sets
                  `item.modelUploadId` against the model it read at start, so a
                  hand-uploaded model is overwritten by the Onshape pull and
                  filed away as a document. */}
              {!hasOnshapeSelection && (
                <VStack spacing={2} className="mt-4 w-full">
                  <label
                    htmlFor="model-upload"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    <Trans>CAD Model</Trans>
                  </label>
                  <div
                    {...getRootProps()}
                    className={`w-full border-2 border-dashed rounded-md p-6 text-center hover:border-primary hover:bg-primary/10 cursor-pointer ${
                      isDragActive
                        ? "border-primary bg-primary/10"
                        : "border-muted"
                    }`}
                  >
                    <input id="model-upload" {...getInputProps()} />
                    {upload !== null ? (
                      <ModelUploadProgress
                        percent={upload.percent}
                        uploaded={upload.uploaded}
                        total={upload.total}
                      />
                    ) : modelFile ? (
                      <>
                        <p className="text-sm font-semibold text-card-foreground">
                          {modelFile.name}
                        </p>
                        <p className="text-xs text-muted-foreground group-hover:text-foreground">
                          {convertKbToString(Math.ceil(modelFile.size / 1024))}
                        </p>
                        <Button
                          size="sm"
                          variant="secondary"
                          className="mt-2"
                          onClick={removeModel}
                        >
                          <Trans>Remove</Trans>
                        </Button>
                      </>
                    ) : (
                      <Loading isLoading={modelIsUploading}>
                        <LuCloudUpload className="mx-auto h-12 w-12 text-muted-foreground group-hover:text-primary-foreground" />
                        <p className="text-xs text-muted-foreground group-hover:text-foreground">
                          {t`Supports ${supportedModelTypes.join(", ")} files`}
                        </p>
                      </Loading>
                    )}
                  </div>
                </VStack>
              )}
            </ModalCardBody>
            <ModalCardFooter>
              <Submit
                isLoading={fetcher.state !== "idle"}
                isDisabled={
                  isEditing
                    ? !permissions.can("update", "parts")
                    : !permissions.can("create", "parts") ||
                      // Chose Onshape but never picked anything: submitting
                      // would post the blank identity to a route that refuses
                      // it, with nothing on screen to explain why.
                      (isFromOnshape && !selection)
                }
              >
                <Trans>Save</Trans>
              </Submit>
            </ModalCardFooter>
          </ValidatedForm>
        </ModalCardContent>
      </ModalCard>
    </ModalCardProvider>
  );
};

export default PartForm;
