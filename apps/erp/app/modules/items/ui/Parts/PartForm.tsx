import { useCarbon } from "@carbon/auth";
import { OnshapeLogo } from "@carbon/ee";
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
  Boolean,
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
import type { OnshapeSelection } from "~/components/OnshapeRevisionPicker";
import { OnshapeRevisionPicker } from "~/components/OnshapeRevisionPicker";
import {
  useCurrencyDecimals,
  useModelUpload,
  useNextItemId,
  usePermissions,
  useUser
} from "~/hooks";
import { useOnshape } from "~/hooks/useOnshape";
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
      message?: string;
      importQueued?: boolean;
    };

type PartFormProps = {
  initialValues: z.infer<typeof partValidator> & { tags?: string[] };
  type?: "card" | "modal";
  onClose?: () => void;
  /**
   * Offer "From Onshape" as a source for this part.
   *
   * Opt-in, never inferred: the inline-create callers above submit to the
   * ordinary action and read a PostgrestResponse back, and would silently break
   * if this form could ever redirect them somewhere else.
   */
  withOnshapeSource?: boolean;
  /** Open the Onshape picker on mount (the Parts table's shortcut link). */
  defaultSource?: "blank" | "onshape";
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
  withOnshapeSource = false,
  defaultSource = "blank"
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
  const onshape = useOnshape();

  // Presentation only. `v2.create` re-reads the pipeline setting server-side and
  // refuses when it is not v2, so this hiding the toggle is never what keeps v2
  // off a legacy company.
  const canUseOnshapeSource =
    withOnshapeSource && onshape.isConnected && !isEditing;

  const [source, setSource] = useState<"blank" | "onshape">(
    canUseOnshapeSource && defaultSource === "onshape" ? "onshape" : "blank"
  );
  const [pickerOpen, setPickerOpen] = useState(
    canUseOnshapeSource && defaultSource === "onshape"
  );
  const [selection, setSelection] = useState<OnshapeSelection | null>(null);
  const [importBom, setImportBom] = useState(false);

  const isFromOnshape = canUseOnshapeSource && source === "onshape";
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
        toast.success(result.message ?? t`Created part from Onshape`);
        navigate(path.to.part(result.itemId));
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
  }, [fetcher.data, fetcher.state, onClose, type, t, navigate]);

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

  const bomOption = selection
    ? bomOptionState({
        elementType: selection.elementType,
        canCreate: permissions.can("create", "parts"),
        canUpdate: permissions.can("update", "parts"),
        canDelete: permissions.can("delete", "parts")
      })
    : { offered: false, disabled: true, reason: null };

  const onOnshapeSelect = (revision: OnshapeSelection) => {
    setSelection(revision);
    setPickerOpen(false);
    // Onshape supplies the identity; it says nothing about how Carbon should
    // treat the part. Seed from what the element IS, then show it for
    // confirmation — the same rule the release mint and the BOM import use.
    const seed = seedFromElementType(revision.elementType);
    setReplenishmentSystem(seed.replenishmentSystem);
    setDefaultMethodType(seed.defaultMethodType);
    // DEFAULT ON for an assembly. Someone who reached this form has already
    // said the part comes from Onshape, so its structure is the expected
    // outcome rather than an opt-in — importing the geometry and leaving the
    // BOM behind is the surprising half. Recomputed per selection, so a body
    // (which has no bill of materials) and a permission-blocked user both fall
    // back to off instead of inheriting a previous assembly's tick.
    const bom = bomOptionState({
      elementType: revision.elementType,
      canCreate: permissions.can("create", "parts"),
      canUpdate: permissions.can("update", "parts"),
      canDelete: permissions.can("delete", "parts")
    });
    setImportBom(bom.offered && !bom.disabled);
  };

  const clearOnshapeSource = () => {
    setSelection(null);
    setImportBom(false);
    setPickerOpen(false);
    setSource("blank");
  };

  const onImportBomChange = (checked: boolean) => {
    setImportBom(checked);
    if (checked) {
      // A BOM under a Buy part is a trap, not a preference:
      // `methodMaterial.methodType` is denormalized from the component's
      // `defaultMethodType`, and `get_method_tree` only resolves a sub-method
      // for "Pull from Inventory" or an explicit `materialMakeMethodId`. A Buy
      // parent would own a sub-tree that never explodes.
      setReplenishmentSystem("Make");
      setDefaultMethodType("Make to Order");
    }
  };

  const identityLocked = hasOnshapeSelection;

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

              {canUseOnshapeSource && (
                <div className="mb-4 w-full rounded-md border border-border p-3">
                  <VStack spacing={2}>
                    <HStack className="w-full items-center justify-between gap-2">
                      <span className="text-xs font-medium text-muted-foreground">
                        <Trans>Source</Trans>
                      </span>
                      <HStack spacing={2}>
                        <Button
                          type="button"
                          size="sm"
                          variant={source === "blank" ? "primary" : "secondary"}
                          onClick={clearOnshapeSource}
                        >
                          <Trans>Blank</Trans>
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant={
                            source === "onshape" ? "primary" : "secondary"
                          }
                          leftIcon={<OnshapeLogo className="h-3.5 w-auto" />}
                          onClick={() => {
                            setSource("onshape");
                            if (!selection) setPickerOpen(true);
                          }}
                        >
                          <Trans>From Onshape</Trans>
                        </Button>
                      </HStack>
                    </HStack>

                    {isFromOnshape && (
                      <HStack className="w-full items-center justify-between gap-2">
                        <p className="text-sm">
                          {selection ? (
                            <>
                              <span className="font-medium">
                                {selection.partNumber}
                              </span>{" "}
                              <span className="text-muted-foreground">
                                {selection.revision}
                                {selection.name ? ` · ${selection.name}` : ""}
                              </span>
                            </>
                          ) : (
                            <span className="text-muted-foreground">
                              <Trans>
                                Pick a released revision. Only released
                                revisions can be imported — Onshape stamps a
                                revision on release.
                              </Trans>
                            </span>
                          )}
                        </p>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => setPickerOpen(true)}
                        >
                          {selection ? (
                            <Trans>Change</Trans>
                          ) : (
                            <Trans>Choose a revision</Trans>
                          )}
                        </Button>
                      </HStack>
                    )}

                    {hasOnshapeSelection && (
                      <p className="w-full text-xs text-muted-foreground">
                        <Trans>
                          The part number, revision and name come from Onshape
                          and cannot be edited here. Everything else is yours.
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
                  <InputControlled
                    name="name"
                    label={t`Short Description`}
                    value={selection.name ?? selection.partNumber}
                    isReadOnly
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
                  isReadOnly={importBom}
                  onChange={(newValue) => {
                    setReplenishmentSystem(newValue?.value ?? "Buy");
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
                <div className="mt-4 w-full">
                  <Boolean
                    name="importBom"
                    label={t`Import the bill of materials`}
                    value={importBom}
                    isDisabled={bomOption.disabled}
                    onChange={onImportBomChange}
                    description={
                      bomOption.disabled ? undefined : (
                        <Trans>
                          Carbon reads this assembly's bill of materials from
                          Onshape and writes it into the part's draft method.
                          The part is created either way.
                        </Trans>
                      )
                    }
                  />
                  {bomOption.reason === "missing-permissions" && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      <Trans>
                        Importing a bill of materials creates and deletes parts,
                        so it needs update and delete permission on parts. The
                        part itself will still be created.
                      </Trans>
                    </p>
                  )}
                  {importBom && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      <Trans>
                        An imported bill of materials only explodes under a Make
                        part, so replenishment is set to Make / Make to Order.
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
      {canUseOnshapeSource && (
        <OnshapeRevisionPicker
          isOpen={pickerOpen}
          onClose={() => {
            setPickerOpen(false);
            // Backing out without ever picking leaves the form on its blank
            // source rather than in a half-chosen state it cannot submit.
            if (!selection) setSource("blank");
          }}
          hideLinked
          title={t`New part from Onshape`}
          description={t`Pick a released revision. Carbon creates the part with Onshape's number and revision, linked by a hidden id so the two stay connected even if the number changes.`}
          confirmLabel={t`Use this revision`}
          onSelect={onOnshapeSelect}
        />
      )}
    </ModalCardProvider>
  );
};

export default PartForm;
