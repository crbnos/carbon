import { useCarbon } from "@carbon/auth";
import { Hidden, Input, Submit, TextArea, ValidatedForm } from "@carbon/form";
import {
  Badge,
  Button,
  cn,
  HStack,
  IconButton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  ToggleGroup,
  ToggleGroupItem,
  VStack
} from "@carbon/react";
import { nanoid } from "nanoid";
import { useCallback, useEffect, useState } from "react";
import { useDropzone } from "react-dropzone";
import {
  LuCirclePlus,
  LuFileVideo,
  LuInfo,
  LuOctagonAlert,
  LuTrash,
  LuTriangleAlert,
  LuUpload
} from "react-icons/lu";
import { useFetcher } from "react-router";
import { toast } from "sonner";
import { Empty } from "~/components";
import { Tool } from "~/components/Form";
import { usePermissions, useUser } from "~/hooks";
import { getPrivateUrl, path } from "~/utils/path";
import {
  type assemblyNoteSeverities,
  assemblyStepRequirementValidator
} from "../../production.models";
import type {
  AssemblyStandardNote,
  AssemblyStepRequirement
} from "../../types";
import AssemblyStandardNotesModal from "./AssemblyStandardNotesModal";

type Severity = (typeof assemblyNoteSeverities)[number];

type AssemblyStepRequirementsProps = {
  stepId: string;
  instructionId: string;
  requirements: AssemblyStepRequirement[];
  standardNotes: AssemblyStandardNote[];
  isDisabled: boolean;
};

/**
 * Per-step process data: tools/fixtures/consumables (catalog-linked or free
 * text), classified notes, reusable standard-note templates, and media
 * attachments.
 */
export default function AssemblyStepRequirements({
  stepId,
  instructionId,
  requirements,
  standardNotes,
  isDisabled
}: AssemblyStepRequirementsProps) {
  const byType = (type: AssemblyStepRequirement["type"]) =>
    requirements.filter((requirement) => requirement.type === type);

  return (
    <Tabs defaultValue="tools" className="w-full">
      <TabsList className="w-full">
        <TabsTrigger className="flex-1" value="tools">
          Tools
        </TabsTrigger>
        <TabsTrigger className="flex-1" value="notes">
          Notes
        </TabsTrigger>
        <TabsTrigger className="flex-1" value="standard-notes">
          Std Notes
        </TabsTrigger>
        <TabsTrigger className="flex-1" value="media">
          Media
        </TabsTrigger>
      </TabsList>
      <TabsContent value="tools">
        <VStack spacing={4} className="w-full py-2">
          <RequirementSection
            title="Tools"
            type="Tool"
            placeholder="e.g. 4mm hex key"
            requirements={byType("Tool")}
            stepId={stepId}
            instructionId={instructionId}
            isDisabled={isDisabled}
          />
          <RequirementSection
            title="Fixtures"
            type="Fixture"
            placeholder="e.g. Assembly jig #3"
            requirements={byType("Fixture")}
            stepId={stepId}
            instructionId={instructionId}
            isDisabled={isDisabled}
          />
          <RequirementSection
            title="Consumables"
            type="Consumable"
            placeholder="e.g. Loctite 242"
            requirements={byType("Consumable")}
            stepId={stepId}
            instructionId={instructionId}
            isDisabled={isDisabled}
          />
        </VStack>
      </TabsContent>
      <TabsContent value="notes">
        <NotesSection
          notes={byType("Note")}
          stepId={stepId}
          instructionId={instructionId}
          isDisabled={isDisabled}
        />
      </TabsContent>
      <TabsContent value="standard-notes">
        <StandardNotesSection
          standardNotes={standardNotes}
          stepId={stepId}
          instructionId={instructionId}
          isDisabled={isDisabled}
        />
      </TabsContent>
      <TabsContent value="media">
        <MediaSection
          media={byType("Media")}
          stepId={stepId}
          instructionId={instructionId}
          isDisabled={isDisabled}
        />
      </TabsContent>
    </Tabs>
  );
}

function RequirementSection({
  title,
  type,
  placeholder,
  requirements,
  stepId,
  instructionId,
  isDisabled
}: {
  title: string;
  type: "Tool" | "Fixture" | "Consumable";
  placeholder: string;
  requirements: AssemblyStepRequirement[];
  stepId: string;
  instructionId: string;
  isDisabled: boolean;
}) {
  const fetcher = useFetcher<{ success: boolean }>();
  // Remount the form after a successful add so the input clears
  const [formKey, setFormKey] = useState(0);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success) {
      setFormKey((key) => key + 1);
    }
  }, [fetcher.state, fetcher.data]);

  return (
    <VStack spacing={2} className="w-full">
      <h4 className="text-xxs text-foreground/70 uppercase font-light tracking-wide">
        {title}
      </h4>
      {requirements.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No {title.toLowerCase()} to display
        </p>
      ) : (
        <ul className="w-full">
          {requirements.map((requirement) => (
            <RequirementRow
              key={requirement.id}
              requirement={requirement}
              instructionId={instructionId}
              isDisabled={isDisabled}
            />
          ))}
        </ul>
      )}
      {!isDisabled && (
        <ValidatedForm
          key={formKey}
          validator={assemblyStepRequirementValidator}
          method="post"
          action={path.to.newAssemblyStepRequirement(instructionId)}
          fetcher={fetcher}
          className="w-full"
        >
          <Hidden name="stepId" value={stepId} />
          <Hidden name="type" value={type} />
          <VStack spacing={2} className="w-full">
            {type === "Tool" && <Tool name="itemId" />}
            <HStack className="w-full items-start" spacing={2}>
              <div className="flex-1 min-w-0">
                <Input
                  name="name"
                  placeholder={
                    type === "Tool"
                      ? `or enter a name: ${placeholder}`
                      : placeholder
                  }
                />
              </div>
              <Submit
                variant="secondary"
                leftIcon={<LuCirclePlus />}
                isDisabled={fetcher.state !== "idle"}
              >
                Add
              </Submit>
            </HStack>
          </VStack>
        </ValidatedForm>
      )}
    </VStack>
  );
}

function RequirementRow({
  requirement,
  instructionId,
  isDisabled,
  children
}: {
  requirement: AssemblyStepRequirement;
  instructionId: string;
  isDisabled: boolean;
  children?: React.ReactNode;
}) {
  const deleteFetcher = useFetcher<{ success: boolean }>();
  const permissions = usePermissions();

  // Optimistically remove the row while the delete is in flight
  if (deleteFetcher.state !== "idle") return null;

  return (
    <li className="flex w-full items-center gap-2 border-b border-border py-1.5 text-sm">
      {children ?? (
        <>
          <span
            className="min-w-0 flex-1 truncate"
            title={requirement.name ?? undefined}
          >
            {requirement.name}
          </span>
          {requirement.item?.readableIdWithRevision && (
            <span className="text-xs text-muted-foreground">
              {requirement.item.readableIdWithRevision}
            </span>
          )}
          {requirement.quantity > 1 && (
            <Badge variant="secondary" className="tabular-nums">
              ×{requirement.quantity}
            </Badge>
          )}
        </>
      )}
      {!isDisabled && permissions.can("delete", "production") && (
        <IconButton
          aria-label={`Delete ${requirement.name ?? "requirement"}`}
          icon={<LuTrash />}
          variant="ghost"
          size="sm"
          onClick={() => {
            deleteFetcher.submit(new FormData(), {
              method: "post",
              action: path.to.deleteAssemblyStepRequirement(
                instructionId,
                requirement.id
              )
            });
          }}
        />
      )}
    </li>
  );
}

const severityStyles: Record<
  Severity,
  { icon: typeof LuInfo; className: string }
> = {
  Info: { icon: LuInfo, className: "text-blue-500" },
  Caution: { icon: LuTriangleAlert, className: "text-yellow-500" },
  Warning: { icon: LuOctagonAlert, className: "text-red-500" }
};

export function SeverityIcon({ severity }: { severity: Severity | null }) {
  const { icon: Icon, className } = severityStyles[severity ?? "Info"];
  return <Icon className={cn("h-4 w-4 shrink-0", className)} aria-hidden />;
}

function NotesSection({
  notes,
  stepId,
  instructionId,
  isDisabled
}: {
  notes: AssemblyStepRequirement[];
  stepId: string;
  instructionId: string;
  isDisabled: boolean;
}) {
  const fetcher = useFetcher<{ success: boolean }>();
  const [formKey, setFormKey] = useState(0);
  const [severity, setSeverity] = useState<Severity>("Info");

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success) {
      setFormKey((key) => key + 1);
      setSeverity("Info");
    }
  }, [fetcher.state, fetcher.data]);

  return (
    <VStack spacing={2} className="w-full py-2">
      {notes.length === 0 ? (
        <p className="text-xs text-muted-foreground">No notes to display</p>
      ) : (
        <ul className="w-full">
          {notes.map((note) => (
            <RequirementRow
              key={note.id}
              requirement={note}
              instructionId={instructionId}
              isDisabled={isDisabled}
            >
              <SeverityIcon severity={note.severity} />
              <span className="min-w-0 flex-1 whitespace-pre-wrap text-sm">
                {note.text}
              </span>
            </RequirementRow>
          ))}
        </ul>
      )}
      {!isDisabled && (
        <ValidatedForm
          key={formKey}
          validator={assemblyStepRequirementValidator}
          method="post"
          action={path.to.newAssemblyStepRequirement(instructionId)}
          fetcher={fetcher}
          className="w-full"
        >
          <Hidden name="stepId" value={stepId} />
          <Hidden name="type" value="Note" />
          <Hidden name="severity" value={severity} />
          <VStack spacing={2} className="w-full">
            <TextArea name="text" placeholder="Add a note for this step" />
            <HStack className="w-full justify-between">
              <ToggleGroup
                type="single"
                value={severity}
                onValueChange={(value) => {
                  if (value) setSeverity(value as Severity);
                }}
              >
                <ToggleGroupItem value="Info" aria-label="Info">
                  <SeverityIcon severity="Info" />
                </ToggleGroupItem>
                <ToggleGroupItem value="Caution" aria-label="Caution">
                  <SeverityIcon severity="Caution" />
                </ToggleGroupItem>
                <ToggleGroupItem value="Warning" aria-label="Warning">
                  <SeverityIcon severity="Warning" />
                </ToggleGroupItem>
              </ToggleGroup>
              <Submit
                variant="secondary"
                leftIcon={<LuCirclePlus />}
                isDisabled={fetcher.state !== "idle"}
              >
                Add Note
              </Submit>
            </HStack>
          </VStack>
        </ValidatedForm>
      )}
    </VStack>
  );
}

function StandardNotesSection({
  standardNotes,
  stepId,
  instructionId,
  isDisabled
}: {
  standardNotes: AssemblyStandardNote[];
  stepId: string;
  instructionId: string;
  isDisabled: boolean;
}) {
  const permissions = usePermissions();
  const [manageOpen, setManageOpen] = useState(false);
  const insertFetcher = useFetcher<{ success: boolean }>();

  const onInsert = (note: AssemblyStandardNote) => {
    // Copy semantics: editing the template later never changes the step
    const formData = new FormData();
    formData.append("stepId", stepId);
    formData.append("type", "Note");
    formData.append("text", note.content);
    formData.append("severity", note.severity);
    insertFetcher.submit(formData, {
      method: "post",
      action: path.to.newAssemblyStepRequirement(instructionId)
    });
  };

  return (
    <VStack spacing={2} className="w-full py-2">
      {standardNotes.length === 0 ? (
        <Empty className="border-none">
          <p className="text-sm text-muted-foreground max-w-[300px] text-center">
            Standard notes are reusable note templates shared across your
            company
          </p>
        </Empty>
      ) : (
        <ul className="w-full">
          {standardNotes.map((note) => (
            <li
              key={note.id}
              className="flex w-full items-center gap-2 border-b border-border py-1.5 text-sm"
            >
              <SeverityIcon severity={note.severity} />
              <VStack spacing={0} className="min-w-0 flex-1">
                <span className="truncate font-medium">{note.name}</span>
                <span
                  className="truncate text-xs text-muted-foreground"
                  title={note.content}
                >
                  {note.content}
                </span>
              </VStack>
              {!isDisabled && (
                <Button
                  variant="secondary"
                  size="sm"
                  isDisabled={insertFetcher.state !== "idle"}
                  onClick={() => onInsert(note)}
                >
                  Insert
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {permissions.can("update", "production") && (
        <Button
          variant="ghost"
          size="sm"
          className="self-end"
          onClick={() => setManageOpen(true)}
        >
          Manage
        </Button>
      )}
      {manageOpen && (
        <AssemblyStandardNotesModal
          standardNotes={standardNotes}
          onClose={() => setManageOpen(false)}
        />
      )}
    </VStack>
  );
}

const MAX_MEDIA_BYTES = 50 * 1024 * 1024;

function MediaSection({
  media,
  stepId,
  instructionId,
  isDisabled
}: {
  media: AssemblyStepRequirement[];
  stepId: string;
  instructionId: string;
  isDisabled: boolean;
}) {
  const { carbon } = useCarbon();
  const { company } = useUser();
  const fetcher = useFetcher<{ success: boolean }>();
  const [isUploading, setIsUploading] = useState(false);

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      if (!carbon || !company.id) return;
      setIsUploading(true);
      try {
        for (const file of acceptedFiles) {
          if (file.size > MAX_MEDIA_BYTES) {
            toast.error(`${file.name} is larger than 50MB`);
            continue;
          }
          const extension = file.name.split(".").pop() ?? "bin";
          const filePath = `${company.id}/assembly/${instructionId}/${stepId}/${nanoid()}.${extension}`;
          const upload = await carbon.storage
            .from("private")
            .upload(filePath, file);
          if (upload.error || !upload.data) {
            toast.error(`Failed to upload ${file.name}`);
            continue;
          }
          const formData = new FormData();
          formData.append("stepId", stepId);
          formData.append("type", "Media");
          formData.append("name", file.name);
          formData.append("filePath", upload.data.path);
          fetcher.submit(formData, {
            method: "post",
            action: path.to.newAssemblyStepRequirement(instructionId)
          });
        }
      } finally {
        setIsUploading(false);
      }
    },
    [carbon, company.id, instructionId, stepId, fetcher]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "image/*": [], "video/*": [] },
    disabled: isDisabled || isUploading
  });

  return (
    <VStack spacing={2} className="w-full py-2">
      {media.length === 0 ? (
        <p className="text-xs text-muted-foreground">No media to display</p>
      ) : (
        <ul className="w-full">
          {media.map((item) => (
            <RequirementRow
              key={item.id}
              requirement={item}
              instructionId={instructionId}
              isDisabled={isDisabled}
            >
              <MediaThumbnail requirement={item} />
              <span
                className="min-w-0 flex-1 truncate"
                title={item.name ?? undefined}
              >
                {item.name}
              </span>
            </RequirementRow>
          ))}
        </ul>
      )}
      {!isDisabled && (
        <div
          {...getRootProps()}
          className={cn(
            "flex w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground hover:bg-accent/30",
            isDragActive && "border-primary bg-accent/30",
            isUploading && "pointer-events-none opacity-50"
          )}
        >
          <input {...getInputProps()} />
          <LuUpload className="h-4 w-4" />
          <p>
            {isUploading
              ? "Uploading…"
              : "Drop images or videos here, or click to browse"}
          </p>
        </div>
      )}
    </VStack>
  );
}

function MediaThumbnail({
  requirement
}: {
  requirement: AssemblyStepRequirement;
}) {
  if (!requirement.filePath) return null;
  const isVideo = /\.(mp4|mov|webm|avi|mkv)$/i.test(requirement.filePath);
  if (isVideo) {
    return <LuFileVideo className="h-8 w-8 shrink-0 text-muted-foreground" />;
  }
  return (
    <a
      href={getPrivateUrl(requirement.filePath)}
      target="_blank"
      rel="noreferrer"
      onClick={(event) => event.stopPropagation()}
    >
      <img
        src={getPrivateUrl(requirement.filePath)}
        alt={requirement.name ?? "Attachment"}
        className="h-8 w-8 shrink-0 rounded-sm border border-border object-cover"
      />
    </a>
  );
}
