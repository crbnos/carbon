import { useCarbon } from "@carbon/auth";
import type { Database } from "@carbon/database";
import { Button, cn, IconButton, Label, VStack } from "@carbon/react";
import { supportedModelTypes } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { SupabaseClient } from "@supabase/supabase-js";
import { nanoid } from "nanoid";
import { useEffect, useMemo, useState } from "react";
import { LuBox, LuCirclePlus, LuMapPin, LuX } from "react-icons/lu";
import type { SlideAnnotation, SlideSize } from "~/modules/shared";
import { getPrivateUrl, path } from "~/utils/path";
import { SlideAnnotator } from "./SlideAnnotator";

// Single fixed slide card size — slides are no longer individually resizable.
const SLIDE_CARD_WIDTH = "w-40";
const SLIDE_IMAGE_HEIGHT = "h-28";

// File-input accept for 3D model slides — everything the ModelViewer can parse
// client-side (STEP additionally gets converted to GLB by the assembler service).
export const MODEL_FILE_ACCEPT = supportedModelTypes
  .map((type) => `.${type}`)
  .join(",");

// Upload a 3D model file for a step slide: the raw file goes to the private bucket
// under the models prefix, then the model-upload API registers the modelUpload row —
// `convert` also starts the assembler's STEP → GLB conversion (best-effort, so the
// slide still works via client-side parsing when the assembler is unavailable).
// Returns the new modelUpload id, or null on failure.
export async function uploadStepSlideModel(
  carbon: SupabaseClient<Database>,
  companyId: string,
  file: File
): Promise<string | null> {
  const modelUploadId = nanoid();
  const ext = file.name.split(".").pop();
  const upload = await carbon.storage
    .from("private")
    .upload(`${companyId}/models/${modelUploadId}.${ext}`, file, {
      upsert: true
    });
  if (upload.error || !upload.data) return null;

  const formData = new FormData();
  formData.append("name", file.name);
  formData.append("modelId", modelUploadId);
  formData.append("modelPath", upload.data.path);
  formData.append("size", String(file.size));
  formData.append("convert", "true");

  const response = await fetch(path.to.api.modelUpload, {
    method: "POST",
    body: formData
  });
  if (!response.ok) return null;
  return modelUploadId;
}

export type EditorSlide = {
  key: string;
  // A slide is image XOR model: exactly one of imagePath / modelUploadId is set.
  imagePath: string | null;
  modelUploadId?: string | null;
  caption: string | null;
  size: SlideSize | null;
  annotations: SlideAnnotation[] | null;
};

type SlideModelMeta = {
  id: string;
  name: string | null;
  thumbnailPath: string | null;
  processingStatus: string | null;
};

// Display metadata for the model slides (name, thumbnail, conversion status), fetched
// client-side so the editors don't have to thread a modelUpload join through their
// loaders. Re-polls while a STEP → GLB conversion is in flight so the "Converting…"
// badge resolves without a reload.
function useSlideModels(slides: EditorSlide[]) {
  const { carbon } = useCarbon();
  const [models, setModels] = useState<Record<string, SlideModelMeta>>({});

  const idsKey = useMemo(
    () =>
      Array.from(
        new Set(
          slides
            .map((slide) => slide.modelUploadId)
            .filter((id): id is string => !!id)
        )
      )
        .sort()
        .join(","),
    [slides]
  );

  const hasPending = Object.values(models).some(
    (model) =>
      model.processingStatus === "Queued" ||
      model.processingStatus === "Processing"
  );

  useEffect(() => {
    if (!carbon || !idsKey) {
      setModels({});
      return;
    }
    let cancelled = false;
    const load = async () => {
      const { data } = await carbon
        .from("modelUpload")
        .select("id, name, thumbnailPath, processingStatus")
        .in("id", idsKey.split(","));
      if (cancelled || !data) return;
      setModels(Object.fromEntries(data.map((model) => [model.id, model])));
    };
    load();
    const interval = hasPending ? setInterval(load, 8000) : undefined;
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [carbon, idsKey, hasPending]);

  return models;
}

// Presentational slides grid — header + "Add slide" / "Add model" + cards. An image
// slide shows the picture with its numbered pins; a model slide shows the 3D model's
// thumbnail (or a placeholder) with a 3D badge — pins are image-only. Shared by the
// create form (draft buffer, attached after the step is saved) and the edit form
// (persisted immediately via the slide routes). Used by both the item method editor
// (BillOfProcess) and the job editor (JobBillOfProcess). See
// .ai/specs/2026-07-14-mes-execution-views.md §4.
export function SlidesEditor({
  slides,
  isDisabled,
  busy,
  fileInputRef,
  onFileChange,
  modelInputRef,
  onModelFileChange,
  onRemove,
  onCaptionBlur,
  onAnnotationsChange
}: {
  slides: EditorSlide[];
  isDisabled: boolean;
  busy: boolean;
  fileInputRef: React.RefObject<HTMLInputElement>;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  // Optional 3D-model upload wiring; when absent the editor is image-only.
  modelInputRef?: React.RefObject<HTMLInputElement>;
  onModelFileChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemove: (index: number) => void;
  onCaptionBlur: (index: number, caption: string) => void;
  onAnnotationsChange: (index: number, annotations: SlideAnnotation[]) => void;
}) {
  const { t } = useLingui();
  const [annotatingIndex, setAnnotatingIndex] = useState<number | null>(null);
  const annotating = annotatingIndex == null ? null : slides[annotatingIndex];
  const models = useSlideModels(slides);

  if (isDisabled && slides.length === 0) return null;

  const withModels = !!modelInputRef && !!onModelFileChange;

  return (
    <VStack spacing={2} className="w-full col-span-2 border-t pt-4">
      <div className="flex w-full items-center justify-between">
        <Label className="text-xs text-muted-foreground">Slides</Label>
        {!isDisabled && (
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={onFileChange}
            />
            {withModels && (
              <input
                ref={modelInputRef}
                type="file"
                accept={MODEL_FILE_ACCEPT}
                className="hidden"
                onChange={onModelFileChange}
              />
            )}
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<LuCirclePlus />}
              isLoading={busy}
              isDisabled={busy}
              onClick={() => fileInputRef.current?.click()}
            >
              Add slide
            </Button>
            {withModels && (
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<LuBox />}
                isLoading={busy}
                isDisabled={busy}
                onClick={() => modelInputRef?.current?.click()}
              >
                Add model
              </Button>
            )}
          </div>
        )}
      </div>
      {slides.length === 0 ? (
        <p className="w-full text-xs text-muted-foreground">No slides</p>
      ) : (
        <div className="flex w-full flex-wrap items-start gap-3">
          {slides.map((slide, index) => {
            const pins = slide.annotations ?? [];
            const model = slide.modelUploadId
              ? models[slide.modelUploadId]
              : undefined;
            const converting =
              model?.processingStatus === "Queued" ||
              model?.processingStatus === "Processing";
            return (
              <div
                key={slide.key}
                className={cn(
                  "flex flex-col gap-1 rounded-lg border p-2",
                  SLIDE_CARD_WIDTH
                )}
              >
                <div className="relative">
                  {slide.modelUploadId ? (
                    <div
                      className={cn(
                        "flex w-full items-center justify-center rounded-md bg-muted/40",
                        SLIDE_IMAGE_HEIGHT
                      )}
                    >
                      {model?.thumbnailPath ? (
                        <img
                          src={getPrivateUrl(model.thumbnailPath)}
                          alt={slide.caption ?? model?.name ?? "3D model"}
                          className="h-full w-full rounded-md object-contain"
                        />
                      ) : (
                        <LuBox className="size-8 text-muted-foreground" />
                      )}
                      <span className="pointer-events-none absolute left-1 top-1 rounded bg-muted px-1 text-[9px] font-semibold text-muted-foreground">
                        3D
                      </span>
                      {converting && (
                        <span className="pointer-events-none absolute bottom-1 left-1 rounded bg-muted px-1 text-[9px] text-muted-foreground">
                          {t`Converting…`}
                        </span>
                      )}
                    </div>
                  ) : (
                    <>
                      <img
                        src={
                          slide.imagePath ? getPrivateUrl(slide.imagePath) : ""
                        }
                        alt={slide.caption ?? "Slide"}
                        className={cn(
                          "w-full rounded-md bg-muted/40 object-contain",
                          SLIDE_IMAGE_HEIGHT
                        )}
                      />
                      {/* Read-only pin preview so an annotated slide reads at a glance. */}
                      {pins.map((pin, i) => (
                        <span
                          key={pin.id}
                          className="pointer-events-none absolute flex size-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white text-[8px] font-semibold text-white shadow"
                          style={{
                            left: `${pin.x * 100}%`,
                            top: `${pin.y * 100}%`,
                            backgroundColor: pin.color ?? "#ef4444"
                          }}
                        >
                          {i + 1}
                        </span>
                      ))}
                    </>
                  )}
                  {!isDisabled && (
                    <IconButton
                      aria-label={t`Remove slide`}
                      icon={<LuX />}
                      variant="secondary"
                      size="sm"
                      className="absolute right-1 top-1"
                      onClick={() => onRemove(index)}
                    />
                  )}
                </div>
                {slide.modelUploadId && model?.name && (
                  <p
                    className="w-full truncate text-[10px] text-muted-foreground"
                    title={model.name}
                  >
                    {model.name}
                  </p>
                )}
                {!isDisabled && !slide.modelUploadId && (
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="secondary"
                      size="sm"
                      className="h-6 px-2 text-[10px]"
                      leftIcon={<LuMapPin className="size-3" />}
                      onClick={() => setAnnotatingIndex(index)}
                    >
                      {pins.length > 0 ? pins.length : t`Pin`}
                    </Button>
                  </div>
                )}
                <input
                  type="text"
                  aria-label={t`Caption`}
                  placeholder={t`Caption`}
                  defaultValue={slide.caption ?? ""}
                  disabled={isDisabled}
                  onBlur={(e) => onCaptionBlur(index, e.target.value)}
                  className="w-full rounded-md border bg-transparent px-2 py-1 text-xs"
                />
              </div>
            );
          })}
        </div>
      )}

      {annotating?.imagePath && annotatingIndex != null && (
        <SlideAnnotator
          open
          imageUrl={getPrivateUrl(annotating.imagePath)}
          initial={annotating.annotations ?? []}
          onSave={(next) => {
            onAnnotationsChange(annotatingIndex, next);
            setAnnotatingIndex(null);
          }}
          onClose={() => setAnnotatingIndex(null)}
        />
      )}
    </VStack>
  );
}
