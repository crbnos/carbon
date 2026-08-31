import { useCarbon } from "@carbon/auth";
import {
  Combobox,
  DateTimePicker,
  Hidden,
  Input as InputField,
  Number,
  Select,
  Submit,
  ValidatedForm
} from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import {
  Button,
  Checkbox,
  cn,
  generateHTML,
  HStack,
  IconButton,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Switch,
  Table,
  Tbody,
  Td,
  Tr,
  toast,
  useDisclosure,
  VStack
} from "@carbon/react";
import {
  documentHasImages,
  isSupportedSlideImagePath,
  parseMentionsFromDocument,
  stripSpecialCharacters,
  tiptapToText
} from "@carbon/utils";
import { ModelPreview } from "@carbon/viewer/model-preview";
import { Trans, useLingui } from "@lingui/react/macro";
import { useNumberFormatter } from "@react-aria/i18n";
import { nanoid } from "nanoid";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  LuBox,
  LuChevronDown,
  LuChevronRight,
  LuCircleCheck,
  LuFile,
  LuImageOff,
  LuPaperclip,
  LuTrash
} from "react-icons/lu";
import { useFetcher } from "react-router";
import { DateTime } from "~/components";
import { ProcedureStepTypeIcon } from "~/components/Icons";
import { ImageZoomViewer } from "~/components/ImageZoomViewer";
import ItemThumbnail from "~/components/ItemThumbnail";
import { useUser } from "~/hooks";
import { stepRecordValidator } from "~/services/models";
import type { JobOperationStep } from "~/services/types";
import { useItems, usePeople } from "~/stores";
import { getPrivateUrl, path } from "~/utils/path";
import FileDropzone from "../../FileDropzone";

// Render metadata for a 3D model slide, resolved by the loader from modelUpload
// (same shape the assembly view consumes).
export type StepSlideModel = {
  id: string;
  name: string | null;
  modelPath: string | null;
  thumbnailPath: string | null;
  glbPath: string | null;
  optimizedModelPath?: string | null;
  processingStatus?: string | null;
};

// Reference-image annotation pins (mirrors ImageZoomViewer's Annotation shape). The
// slide row stores these as JSON, so we cast when passing them to the viewer.
type SlideAnnotation = {
  id: string;
  x: number;
  y: number;
  label?: string | null;
  color?: string | null;
  toolId?: string | null;
};

// An empty step description is persisted by the ERP editors as
// JSON.stringify({}) === "{}" (and some legacy rows carry it as a tiptap doc
// whose only text is literally "{}"). Treat an empty object, empty doc, or
// "{}"-only text as "no description" so we render nothing instead of a bare "{}".
function hasStepDescription(
  description: JobOperationStep["description"]
): boolean {
  if (!description) return false;
  const doc = description as JSONContent;
  const text = tiptapToText(doc).trim();
  if (text.length > 0 && text !== "{}") return true;
  if (parseMentionsFromDocument(doc).length > 0) return true;
  // A step's reference imagery is frequently an image-only description (no text,
  // no @-mention). Without this the description block — and its <img> — is hidden.
  return documentHasImages(doc);
}

/**
 * One step of the operator's procedure: its type icon, name, record/complete
 * controls, reference slides (images, 3D models, and an explicit placeholder for
 * an image stored in a format no browser can paint) and its description.
 */
export function StepsListItem({
  activeStep,
  step,
  compact = false,
  operationId,
  className,
  slideModels,
  onRecord,
  onDelete
}: {
  activeStep: number;
  step: JobOperationStep;
  compact?: boolean;
  operationId?: string;
  className: string;
  slideModels?: Record<string, StepSlideModel> | null;
  onRecord: (step: JobOperationStep) => void;
  onDelete: (step: JobOperationStep) => void;
}) {
  const fetcher = useFetcher<{ success: boolean }>();
  const user = useUser();
  const { t } = useLingui();
  const { name, description, type, unitOfMeasureCode, minValue, maxValue } =
    step;

  const hasDescription = hasStepDescription(description);
  const mentionIds = hasDescription
    ? parseMentionsFromDocument(description as JSONContent)
    : [];
  const disclosure = useDisclosure({
    defaultIsOpen: hasDescription
  });

  // Reference slides attached to this step in the Bill of Process, in planner order.
  // A slide is image XOR model, and both render here: an image opens the zoom viewer
  // with its pins, a model opens the 3D preview. An image whose stored format no
  // browser can paint (rows written before the upload gate) becomes an explicit
  // placeholder rather than a broken <img>.
  const slideTiles = (step.jobOperationStepSlide ?? [])
    .slice()
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((slide) => {
      if (slide.modelUploadId) {
        const model = slideModels?.[slide.modelUploadId] ?? null;
        return {
          kind: "model" as const,
          id: slide.id,
          caption: slide.caption,
          name: model?.name ?? null,
          thumbnailUrl: model?.thumbnailPath
            ? getPrivateUrl(model.thumbnailPath)
            : null,
          // Prefer the assembler-converted GLB, then the optimiser's recorded
          // artifact. Never guess a path: a non-null glbUrl switches ModelPreview
          // to its server tier and disables the raw WASM fallback entirely, so a
          // speculative URL that 404s leaves the operator with "Couldn't load the
          // 3D model" instead of the model. Null here = parse the raw upload.
          glbUrl: model?.glbPath
            ? getPrivateUrl(model.glbPath)
            : model?.optimizedModelPath
              ? getPrivateUrl(model.optimizedModelPath)
              : null,
          rawUrl: model?.modelPath ? getPrivateUrl(model.modelPath) : null,
          converting:
            model?.processingStatus === "Queued" ||
            model?.processingStatus === "Processing"
        };
      }
      if (!isSupportedSlideImagePath(slide.imagePath)) {
        return {
          kind: "unsupported" as const,
          id: slide.id,
          caption: slide.caption
        };
      }
      return {
        kind: "image" as const,
        id: slide.id,
        url: getPrivateUrl(slide.imagePath as string),
        caption: slide.caption,
        // Slides copied from the method (get-method) can persist annotations as a
        // non-array JSON value ({}), so normalize before the viewer calls .map().
        annotations: Array.isArray(slide.annotations)
          ? (slide.annotations as SlideAnnotation[])
          : []
      };
    });
  const imageSlides = slideTiles.filter((tile) => tile.kind === "image");
  const modelSlides = slideTiles.filter((tile) => tile.kind === "model");
  const [viewerSlideId, setViewerSlideId] = useState<string | null>(null);
  const [modelSlideId, setModelSlideId] = useState<string | null>(null);
  const activeSlide =
    imageSlides.find((slide) => slide.id === viewerSlideId) ?? null;
  const activeModel =
    modelSlides.find((slide) => slide.id === modelSlideId) ?? null;

  if (!operationId) return null;
  const record = step.jobOperationStepRecord.find(
    (r) => r.index === activeStep
  );

  return (
    <div className={cn("border-b hover:bg-muted/30 p-6", className)}>
      <div className="flex flex-1 justify-between items-center w-full gap-2">
        <HStack spacing={4} className="w-2/3">
          <HStack spacing={4} className="flex-1">
            <div className="bg-muted border rounded-full flex items-center justify-center p-2">
              <ProcedureStepTypeIcon type={type} />
            </div>
            <VStack spacing={0}>
              <HStack>
                <span className="text-foreground text-sm font-medium">
                  {name}
                </span>
              </HStack>
              {type === "Measurement" && (
                <span className="text-xs text-muted-foreground">
                  {minValue !== null && maxValue !== null
                    ? t`Must be between ${minValue} and ${maxValue} ${unitOfMeasureCode}`
                    : minValue !== null
                      ? t`Must be > ${minValue} ${unitOfMeasureCode}`
                      : maxValue !== null
                        ? t`Must be < ${maxValue} ${unitOfMeasureCode}`
                        : null}
                </span>
              )}
            </VStack>
            {!compact && (
              <PreviewStepRecord step={step} activeStep={activeStep} />
            )}
          </HStack>
        </HStack>
        <div className="flex items-center justify-end gap-2">
          {record ? (
            <div className="flex items-center gap-2">
              {type !== "Task" &&
                (compact ? (
                  <IconButton
                    aria-label="Update step"
                    variant="secondary"
                    size="lg"
                    icon={<LuCircleCheck />}
                    isDisabled={record?.createdBy !== user?.id}
                    onClick={() => onRecord(step)}
                    className={cn(
                      "text-emerald-500",
                      step.minValue !== null &&
                        record?.numericValue != null &&
                        record?.numericValue < step.minValue &&
                        "text-red-500",
                      step.maxValue !== null &&
                        record?.numericValue != null &&
                        record?.numericValue > step.maxValue &&
                        "text-red-500"
                    )}
                  />
                ) : (
                  <Button
                    variant="secondary"
                    size="lg"
                    rightIcon={<LuCircleCheck />}
                    onClick={() => onRecord(step)}
                  >
                    <Trans>Update</Trans>
                  </Button>
                ))}
              <IconButton
                aria-label="Delete step"
                variant="secondary"
                size="lg"
                icon={<LuTrash />}
                isDisabled={record?.createdBy !== user?.id}
                onClick={() => onDelete(step)}
              />
            </div>
          ) : type === "Task" ? (
            <fetcher.Form method="post" action={path.to.record}>
              <input type="hidden" name="index" value={activeStep} />
              <input type="hidden" name="jobOperationStepId" value={step.id} />

              <input type="hidden" name="booleanValue" value="true" />
              {compact ? (
                <IconButton
                  aria-label="Record step"
                  variant="secondary"
                  size="lg"
                  icon={<LuCircleCheck />}
                  type="submit"
                  isLoading={fetcher.state !== "idle"}
                  isDisabled={fetcher.state !== "idle"}
                />
              ) : (
                <Button
                  type="submit"
                  variant="secondary"
                  size="lg"
                  rightIcon={<LuCircleCheck />}
                  isLoading={fetcher.state !== "idle"}
                  isDisabled={fetcher.state !== "idle"}
                >
                  <Trans>Complete</Trans>
                </Button>
              )}
            </fetcher.Form>
          ) : compact ? (
            <IconButton
              aria-label="Record step"
              variant="secondary"
              size="lg"
              icon={<LuCircleCheck />}
              onClick={() => onRecord(step)}
            />
          ) : (
            <Button
              variant="secondary"
              size="lg"
              rightIcon={<LuCircleCheck />}
              onClick={() => onRecord(step)}
            >
              <Trans>Record</Trans>
            </Button>
          )}
          {hasDescription && (
            <IconButton
              aria-label={
                disclosure.isOpen ? "Hide description" : "Show description"
              }
              variant="ghost"
              size="lg"
              isDisabled={!hasDescription}
              icon={disclosure.isOpen ? <LuChevronDown /> : <LuChevronRight />}
              onClick={disclosure.onToggle}
            />
          )}
        </div>
      </div>
      {slideTiles.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {slideTiles.map((slide, i) => {
            const tileClass = cn(
              "relative flex h-24 w-32 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted/40",
              slide.kind !== "unsupported" &&
                "transition-transform active:scale-[0.96]"
            );
            if (slide.kind === "unsupported") {
              return (
                <div
                  key={slide.id}
                  title={slide.caption ?? undefined}
                  className={cn(tileClass, "flex-col gap-1 px-2 text-center")}
                >
                  <LuImageOff className="size-5 text-muted-foreground" />
                  <span className="text-[10px] leading-tight text-muted-foreground">
                    <Trans>Image format not supported</Trans>
                  </span>
                </div>
              );
            }
            if (slide.kind === "model") {
              return (
                <button
                  key={slide.id}
                  type="button"
                  aria-label={
                    slide.caption || slide.name || `Reference model ${i + 1}`
                  }
                  title={slide.caption ?? slide.name ?? undefined}
                  onClick={() => setModelSlideId(slide.id)}
                  className={tileClass}
                >
                  {slide.thumbnailUrl ? (
                    <img
                      src={slide.thumbnailUrl}
                      alt={slide.caption || slide.name || ""}
                      className="h-full w-full object-contain"
                      loading="lazy"
                    />
                  ) : (
                    <LuBox className="size-8 text-muted-foreground" />
                  )}
                  <span className="pointer-events-none absolute left-1 top-1 rounded bg-muted px-1 text-[10px] font-semibold text-muted-foreground">
                    3D
                  </span>
                  {slide.converting && (
                    <span className="pointer-events-none absolute bottom-1 left-1 rounded bg-muted px-1 text-[10px] text-muted-foreground">
                      <Trans>Converting…</Trans>
                    </span>
                  )}
                </button>
              );
            }
            return (
              <button
                key={slide.id}
                type="button"
                aria-label={slide.caption || `Reference image ${i + 1}`}
                title={slide.caption ?? undefined}
                onClick={() => setViewerSlideId(slide.id)}
                className={tileClass}
              >
                <img
                  src={slide.url}
                  alt={slide.caption || ""}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              </button>
            );
          })}
        </div>
      )}
      {disclosure.isOpen && hasDescription && (
        <div
          className="my-4 text-sm prose prose-sm dark:prose-invert"
          dangerouslySetInnerHTML={{
            __html: generateHTML(description as JSONContent)
          }}
        />
      )}
      {mentionIds.length > 0 && <ItemsSummaryTable itemsIds={mentionIds} />}
      <ImageZoomViewer
        open={activeSlide !== null}
        src={activeSlide?.url ?? null}
        caption={activeSlide?.caption}
        annotations={activeSlide?.annotations ?? []}
        onClose={() => setViewerSlideId(null)}
      />
      {/* 3D model slides: the same viewer the assembly view uses, in a modal so the
          step list stays a list. Mounted only while open — the viewer pulls a WASM
          tier the operator shouldn't pay for on every step. */}
      <Modal
        open={activeModel !== null}
        onOpenChange={(open) => {
          if (!open) setModelSlideId(null);
        }}
      >
        <ModalContent size="xlarge">
          <ModalHeader>
            <ModalTitle>
              {activeModel?.caption || activeModel?.name || t`3D model`}
            </ModalTitle>
          </ModalHeader>
          <ModalBody>
            {activeModel && (
              <div className="h-[60vh] w-full overflow-hidden rounded-lg border">
                <ModelPreview
                  key={`slide-model-${activeModel.id}`}
                  glbUrl={activeModel.glbUrl}
                  rawUrl={activeModel.rawUrl}
                  className="rounded-none"
                />
              </div>
            )}
          </ModalBody>
        </ModalContent>
      </Modal>
    </div>
  );
}

function ItemsSummaryTable({ itemsIds }: { itemsIds: string[] }) {
  const [allItems] = useItems();
  const items = useMemo(() => {
    return itemsIds.map((id) => allItems.find((item) => item.id === id));
  }, [itemsIds, allItems]);
  return (
    <Table className="border rounded-md">
      <Tbody>
        {items.map(
          (item) =>
            item && (
              <Tr className="bg-muted/50 hover:bg-muted/80" key={item.id}>
                <Td className="flex-shrink-0 py-3 w-[60px]">
                  <ItemThumbnail
                    size="lg"
                    thumbnailPath={item?.thumbnailPath ?? undefined}
                    onClick={() => {
                      if (item?.thumbnailPath) {
                        window.open(
                          getPrivateUrl(item.thumbnailPath),
                          "_blank"
                        );
                      }
                    }}
                  />
                </Td>
                <Td className="flex-grow">
                  <div className="flex flex-col gap-1">
                    <span className="text-base font-medium">{item.name}</span>
                    <span className="text-sm font-mono text-muted-foreground">
                      {item.readableIdWithRevision ?? item.id}
                    </span>
                  </div>
                </Td>
              </Tr>
            )
        )}
      </Tbody>
    </Table>
  );
}

export function PreviewStepRecord({
  activeStep,
  step
}: {
  activeStep: number;
  step: JobOperationStep;
}) {
  const [employees] = usePeople();
  const numberFormatter = useNumberFormatter();

  if (!step.jobOperationStepRecord) return null;
  const record = step.jobOperationStepRecord.find(
    (r) => r.index === activeStep
  );

  return (
    <div className="min-w-[200px] truncate text-right font-medium">
      {step.type === "Task" && (
        <Checkbox checked={record?.booleanValue ?? false} />
      )}
      {step.type === "Checkbox" && (
        <Checkbox checked={record?.booleanValue ?? false} />
      )}
      {step.type === "Value" && <p className="text-sm">{record?.value}</p>}
      {step.type === "Measurement" &&
        typeof record?.numericValue === "number" && (
          <p
            className={cn(
              "text-sm",
              step.minValue !== null &&
                record?.numericValue < step.minValue &&
                "text-red-500",
              step.maxValue !== null &&
                record?.numericValue > step.maxValue &&
                "text-red-500"
            )}
          >
            {numberFormatter.format(record?.numericValue)}{" "}
            {step.unitOfMeasureCode}
          </p>
        )}
      {step.type === "Timestamp" && (
        <p className="text-sm">
          <DateTime value={record?.value} variant="absolute" />
        </p>
      )}
      {step.type === "List" && <p className="text-sm">{record?.value}</p>}
      {step.type === "Person" && (
        <p className="text-sm">
          {employees.find((e) => e.id === record?.userValue)?.name}
        </p>
      )}
      {step.type === "File" && record?.value && (
        <div className="flex justify-end gap-2 text-sm">
          <LuPaperclip className="size-4 text-muted-foreground" />
        </div>
      )}
      {step.type === "Inspection" && (
        <div className="flex justify-end gap-2 items-center text-sm">
          {record?.value && (
            <LuPaperclip className="size-4 text-muted-foreground" />
          )}
          <Checkbox checked={record?.booleanValue ?? false} />
        </div>
      )}
    </div>
  );
}

export function RecordModal({
  attribute,
  activeStep,
  onClose
}: {
  attribute: JobOperationStep;
  activeStep: number;
  onClose: () => void;
}) {
  const [employees] = usePeople();
  const employeeOptions = useMemo(() => {
    return employees.map((employee) => ({
      label: employee.name,
      value: employee.id
    }));
  }, [employees]);

  const { t } = useLingui();
  const { carbon } = useCarbon();
  const { company } = useUser();
  const [file, setFile] = useState<File | null>(null);
  const [filePath, setFilePath] = useState<string | null>(null);
  // Bumped on every drop/remove so a stale in-flight upload can't set state
  const uploadIdRef = useRef(0);
  const fetcher = useFetcher<{ success: boolean }>();

  const removeFile = () => {
    uploadIdRef.current += 1;
    setFile(null);
    setFilePath(null);
  };

  const onDrop = async (acceptedFiles: File[]) => {
    if (!acceptedFiles[0] || !carbon) return;
    const fileUpload = acceptedFiles[0];
    const uploadId = ++uploadIdRef.current;

    setFile(fileUpload);
    toast.info(t`Uploading ${fileUpload.name}`);

    const safeName = stripSpecialCharacters(fileUpload.name) || "file";
    const fileName = `${company.id}/job/${attribute.operationId}/${attribute.id}/${nanoid()}/${safeName}`;

    const upload = await carbon?.storage
      .from("private")
      .upload(fileName, fileUpload, {
        cacheControl: `${12 * 60 * 60}`,
        upsert: true
      });

    if (uploadIdRef.current !== uploadId) return;

    if (upload.error) {
      toast.error(t`Failed to upload file: ${fileUpload.name}`);
      removeFile();
    } else if (upload.data?.path) {
      toast.success(t`Uploaded: ${fileUpload.name}`);
      setFilePath(upload.data.path);
    }
  };

  useEffect(() => {
    if (fetcher.data?.success) {
      onClose();
    }
  }, [fetcher.data?.success, onClose]);

  const record = attribute?.jobOperationStepRecord.find(
    (r) => r.index === activeStep
  );

  const [booleanControlled, setBooleanControlled] = useState(
    record?.booleanValue ?? false
  );

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <ModalContent>
        <ValidatedForm
          method="post"
          validator={stepRecordValidator}
          action={path.to.record}
          defaultValues={{
            index: activeStep,
            jobOperationStepId: attribute.id,
            value:
              record?.value ??
              (attribute.type === "Timestamp" ? new Date().toISOString() : ""),
            numericValue: record?.numericValue ?? 0,
            userValue: record?.userValue ?? ""
          }}
          fetcher={fetcher}
        >
          <ModalHeader>
            <ModalTitle>
              <Trans>
                {attribute.name} - Set {activeStep + 1}
              </Trans>
            </ModalTitle>
          </ModalHeader>
          <ModalBody>
            <Hidden name="id" />
            <Hidden name="jobOperationStepId" />
            <Hidden name="index" />
            {attribute.type === "Checkbox" && (
              <Hidden
                name="booleanValue"
                value={booleanControlled ? "true" : "false"}
              />
            )}
            {attribute.type === "File" && (
              <Hidden name="value" value={filePath ?? ""} />
            )}
            {attribute.type === "Inspection" && (
              <>
                <Hidden name="value" value={filePath ?? ""} />
                <Hidden
                  name="booleanValue"
                  value={booleanControlled ? "true" : "false"}
                />
              </>
            )}
            <VStack spacing={4}>
              {hasStepDescription(attribute.description) && (
                <div
                  className="flex flex-col gap-2"
                  dangerouslySetInnerHTML={{
                    __html: generateHTML(attribute.description as JSONContent)
                  }}
                />
              )}
              {attribute.type === "Value" && (
                <InputField name="value" label="" size="lg" />
              )}
              {attribute.type === "Measurement" && (
                <Number name="numericValue" label="" size="lg" />
              )}
              {attribute.type === "Timestamp" && (
                <DateTimePicker name="value" label="" size="lg" />
              )}
              {attribute.type === "Checkbox" && (
                <Switch
                  checked={booleanControlled}
                  onCheckedChange={(checked) => setBooleanControlled(!!checked)}
                />
              )}
              {attribute.type === "Person" && (
                <Combobox
                  name="userValue"
                  label=""
                  options={employeeOptions}
                  size="lg"
                />
              )}
              {attribute.type === "List" && (
                <Select
                  name="value"
                  label=""
                  size="lg"
                  options={(attribute.listValues ?? []).map((value) => ({
                    label: value,
                    value
                  }))}
                />
              )}
              {attribute.type === "File" &&
                (file ? (
                  <div className="flex flex-col gap-2 items-center justify-center py-6 w-full">
                    <LuFile className="size-10 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">{file.name}</p>
                    <Button variant="secondary" size="sm" onClick={removeFile}>
                      <Trans>Remove</Trans>
                    </Button>
                  </div>
                ) : (
                  <FileDropzone onDrop={onDrop} />
                ))}
              {attribute.type === "Inspection" && (
                <>
                  {file ? (
                    <div className="flex flex-col gap-2 items-center justify-center py-6 w-full">
                      <LuFile className="size-10 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">
                        {file.name}
                      </p>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={removeFile}
                      >
                        Remove
                      </Button>
                    </div>
                  ) : (
                    <FileDropzone onDrop={onDrop} />
                  )}
                  <div className="flex items-center justify-between py-4 w-full">
                    <span className="text-sm font-medium">
                      <Trans>Passed Inspection</Trans>
                    </span>
                    <Switch
                      checked={booleanControlled}
                      onCheckedChange={(checked) =>
                        setBooleanControlled(!!checked)
                      }
                    />
                  </div>
                </>
              )}
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" size="lg" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Submit
              size="lg"
              isLoading={fetcher.state !== "idle"}
              isDisabled={
                fetcher.state !== "idle" ||
                (attribute.type === "File" && !filePath)
              }
              rightIcon={<LuCircleCheck />}
              type="submit"
            >
              <Trans>Record</Trans>
            </Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}

export function DeleteStepRecordModal({
  onClose,
  id,
  title,
  description
}: {
  onClose: () => void;
  id: string;
  title: string;
  description: string;
}) {
  const fetcher = useFetcher<{ success: boolean }>();

  useEffect(() => {
    if (fetcher.data?.success) {
      onClose();
    }
  }, [fetcher.data?.success, onClose]);

  return (
    <Modal open={true} onOpenChange={onClose}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>{title}</ModalTitle>
          <ModalDescription>{description}</ModalDescription>
        </ModalHeader>
        <ModalFooter>
          <Button variant="secondary" size="lg" onClick={onClose}>
            <Trans>Cancel</Trans>
          </Button>
          <fetcher.Form method="post" action={path.to.recordDelete(id)}>
            <Button
              size="lg"
              isLoading={fetcher.state !== "idle"}
              isDisabled={fetcher.state !== "idle"}
              type="submit"
              variant="destructive"
            >
              <Trans>Delete</Trans>
            </Button>
          </fetcher.Form>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
