import { useCarbon } from "@carbon/auth";
import { toast } from "@carbon/react";
import { nanoid } from "nanoid";
import { useRef, useState } from "react";
import { useFetcher } from "react-router";
import { SlidesEditor, uploadStepSlideModel } from "~/components/SlidesEditor";
import { useUser } from "~/hooks";
import type { SlideAnnotation, SlideSize } from "~/modules/shared";
import { path } from "~/utils/path";
import type { AssemblyStepSlide } from "../../types";

type AssemblyStepSlidesProps = {
  stepId: string;
  instructionId: string;
  slides: AssemblyStepSlide[];
  isDisabled: boolean;
};

/**
 * Reference slides (images + 3D models) for an assembly step — upload, caption,
 * annotate, delete, persisted immediately via the slide routes. Mirrors the BOP
 * step editor's StepSlides; copied to job operations by the assembly sync.
 */
export default function AssemblyStepSlides({
  stepId,
  instructionId,
  slides: slideRows,
  isDisabled
}: AssemblyStepSlidesProps) {
  const fetcher = useFetcher();
  const captionFetcher = useFetcher();
  const { carbon } = useCarbon();
  const {
    company: { id: companyId }
  } = useUser();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modelInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const slides = slideRows
    .slice()
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  const nextSortOrder = () =>
    slides.reduce((m, s) => Math.max(m, s.sortOrder ?? 0), 0) + 1;

  const onAddFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !carbon) return;
    setUploading(true);
    try {
      const ext = file.name.split(".").pop();
      const fileName = `${companyId}/assembly/${instructionId}/${nanoid()}.${ext}`;
      const result = await carbon.storage
        .from("private")
        .upload(fileName, file);
      if (result.error || !result.data) {
        toast.error("Failed to upload image");
        return;
      }
      const fd = new FormData();
      fd.append("stepId", stepId);
      fd.append("imagePath", result.data.path);
      fd.append("sortOrder", String(nextSortOrder()));
      fetcher.submit(fd, {
        method: "post",
        action: path.to.newAssemblyStepSlide(instructionId)
      });
    } finally {
      setUploading(false);
    }
  };

  // Upload a 3D model and attach it to the step as a model slide. The model-upload
  // API also starts the assembler's STEP → GLB conversion.
  const onAddModelFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !carbon) return;
    setUploading(true);
    try {
      const modelUploadId = await uploadStepSlideModel(carbon, companyId, file);
      if (!modelUploadId) {
        toast.error("Failed to upload model");
        return;
      }
      const fd = new FormData();
      fd.append("stepId", stepId);
      fd.append("modelUploadId", modelUploadId);
      fd.append("sortOrder", String(nextSortOrder()));
      fetcher.submit(fd, {
        method: "post",
        action: path.to.newAssemblyStepSlide(instructionId)
      });
    } finally {
      setUploading(false);
    }
  };

  // Update one slide: always carries the required fields (id → the route updates rather
  // than inserts; stepId + the slide's content field satisfy the validator) plus whatever
  // changed. Fields not sent are preserved, so a caption edit never wipes size/annotations
  // and vice-versa.
  function saveSlide(slide: AssemblyStepSlide, fields: Record<string, string>) {
    const fd = new FormData();
    fd.append("id", slide.id);
    fd.append("stepId", slide.stepId);
    if (slide.imagePath) fd.append("imagePath", slide.imagePath);
    if (slide.modelUploadId) fd.append("modelUploadId", slide.modelUploadId);
    fd.append("sortOrder", String(slide.sortOrder ?? 1));
    for (const [key, value] of Object.entries(fields)) fd.append(key, value);
    captionFetcher.submit(fd, {
      method: "post",
      action: path.to.newAssemblyStepSlide(instructionId)
    });
  }

  return (
    <SlidesEditor
      slides={slides.map((s) => ({
        key: s.id,
        imagePath: s.imagePath,
        modelUploadId: s.modelUploadId,
        caption: s.caption,
        size: (s.size as SlideSize | null) ?? null,
        annotations: (s.annotations as SlideAnnotation[] | null) ?? null
      }))}
      isDisabled={isDisabled}
      busy={uploading || fetcher.state !== "idle"}
      fileInputRef={fileInputRef}
      onFileChange={onAddFile}
      modelInputRef={modelInputRef}
      onModelFileChange={onAddModelFile}
      onRemove={(index) => {
        const slide = slides[index];
        if (!slide) return;
        fetcher.submit(null, {
          method: "post",
          action: path.to.deleteAssemblyStepSlide(instructionId, slide.id)
        });
      }}
      onCaptionBlur={(index, caption) => {
        const slide = slides[index];
        if (slide && (slide.caption ?? "") !== caption)
          saveSlide(slide, { caption });
      }}
      onAnnotationsChange={(index, annotations) => {
        const slide = slides[index];
        if (slide)
          saveSlide(slide, { annotations: JSON.stringify(annotations) });
      }}
    />
  );
}
