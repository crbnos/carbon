import { Hidden, Input, Submit, TextArea, ValidatedForm } from "@carbon/form";
import {
  Button,
  HStack,
  IconButton,
  Modal,
  ModalBody,
  ModalContent,
  ModalHeader,
  ModalTitle,
  ToggleGroup,
  ToggleGroupItem,
  VStack
} from "@carbon/react";
import { useEffect, useState } from "react";
import { LuPencil, LuTrash } from "react-icons/lu";
import { useFetcher } from "react-router";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import {
  type assemblyNoteSeverities,
  assemblyStandardNoteValidator
} from "../../production.models";
import type { AssemblyStandardNote } from "../../types";
import { SeverityIcon } from "./AssemblyStepRequirements";

type Severity = (typeof assemblyNoteSeverities)[number];

/**
 * CRUD for company-level standard note templates. Templates are copied into
 * steps on insert, so edits here never change authored instructions.
 */
export default function AssemblyStandardNotesModal({
  standardNotes,
  onClose
}: {
  standardNotes: AssemblyStandardNote[];
  onClose: () => void;
}) {
  const permissions = usePermissions();
  const formFetcher = useFetcher<{ success: boolean }>();
  const deleteFetcher = useFetcher<{ success: boolean }>();

  const [editing, setEditing] = useState<AssemblyStandardNote | null>(null);
  const [severity, setSeverity] = useState<Severity>("Info");
  const [formKey, setFormKey] = useState(0);

  useEffect(() => {
    if (formFetcher.state === "idle" && formFetcher.data?.success) {
      setEditing(null);
      setSeverity("Info");
      setFormKey((key) => key + 1);
    }
  }, [formFetcher.state, formFetcher.data]);

  const onEdit = (note: AssemblyStandardNote) => {
    setEditing(note);
    setSeverity(note.severity);
    setFormKey((key) => key + 1);
  };

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Standard Notes</ModalTitle>
        </ModalHeader>
        <ModalBody>
          <VStack spacing={4} className="w-full">
            {standardNotes.length > 0 && (
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
                    <IconButton
                      aria-label={`Edit ${note.name}`}
                      icon={<LuPencil />}
                      variant="ghost"
                      size="sm"
                      onClick={() => onEdit(note)}
                    />
                    {permissions.can("delete", "production") && (
                      <IconButton
                        aria-label={`Delete ${note.name}`}
                        icon={<LuTrash />}
                        variant="ghost"
                        size="sm"
                        isDisabled={deleteFetcher.state !== "idle"}
                        onClick={() => {
                          deleteFetcher.submit(new FormData(), {
                            method: "post",
                            action: path.to.deleteAssemblyStandardNote(note.id)
                          });
                        }}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
            <ValidatedForm
              key={formKey}
              validator={assemblyStandardNoteValidator}
              method="post"
              action={
                editing
                  ? path.to.assemblyStandardNote(editing.id)
                  : path.to.newAssemblyStandardNote
              }
              defaultValues={{
                name: editing?.name ?? "",
                content: editing?.content ?? ""
              }}
              fetcher={formFetcher}
              className="w-full"
            >
              <Hidden name="severity" value={severity} />
              <VStack spacing={2} className="w-full">
                <h4 className="text-xxs text-foreground/70 uppercase font-light tracking-wide">
                  {editing ? `Edit "${editing.name}"` : "New standard note"}
                </h4>
                <Input name="name" placeholder="e.g. Apply threadlocker" />
                <TextArea
                  name="content"
                  placeholder="e.g. Apply Loctite 242 to threads before insertion"
                />
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
                  <HStack spacing={2}>
                    {editing && (
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setEditing(null);
                          setSeverity("Info");
                          setFormKey((key) => key + 1);
                        }}
                      >
                        Cancel
                      </Button>
                    )}
                    <Submit isDisabled={formFetcher.state !== "idle"}>
                      {editing ? "Save" : "Create"}
                    </Submit>
                  </HStack>
                </HStack>
              </VStack>
            </ValidatedForm>
          </VStack>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}
