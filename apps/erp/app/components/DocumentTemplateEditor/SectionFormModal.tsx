import type {
  DocumentSectionPlacement,
  FooterOptions,
  HeaderOptions,
  SectionConfig
} from "@carbon/documents/template";
import {
  COMPANY_MERGE_FIELDS,
  DEFAULT_FOOTER_OPTIONS,
  DEFAULT_HEADER_OPTIONS,
  footerOptionsSchema,
  getDocumentLabel,
  headerOptionsSchema,
  mergeToken,
  REGISTRATION_LINE_DOCUMENT_TYPES
} from "@carbon/documents/template";
import type { JSONContent } from "@carbon/react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Label,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  VStack
} from "@carbon/react";
import { Editor } from "@carbon/react/Editor";
import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";

export type SectionFormValue = {
  id: string;
  name: string;
  placement: DocumentSectionPlacement;
  content: JSONContent;
  config?: SectionConfig;
  builtIn?: boolean;
};

const PLACEMENT_LABELS: Record<DocumentSectionPlacement, string> = {
  body: "Body section",
  header: "Page header",
  footer: "Page footer"
};

/**
 * Create/edit a shared document section. Reused by the section library and the
 * template editor — pass `action` to post to the sections route when rendered
 * outside it.
 */
export function SectionFormModal({
  section,
  onClose,
  action
}: {
  section: SectionFormValue | null;
  onClose: () => void;
  action?: string;
}) {
  const fetcher = useFetcher<{ success?: boolean }>();
  const [content, setContent] = useState<JSONContent>(
    section?.content ?? { type: "doc", content: [] }
  );
  const [placement, setPlacement] = useState<DocumentSectionPlacement>(
    section?.placement ?? "body"
  );
  const [config, setConfig] = useState<HeaderOptions & FooterOptions>({
    ...DEFAULT_HEADER_OPTIONS,
    ...DEFAULT_FOOTER_OPTIONS,
    ...(section?.config ?? {})
  });
  // Placement is intrinsic once a section exists — don't let it change.
  const lockPlacement = Boolean(section);
  const isHeader = placement === "header";
  const isFooter = placement === "footer";

  const isSaving = fetcher.state !== "idle";
  const submittedRef = useRef(false);

  const setConfigKey = <K extends keyof (HeaderOptions & FooterOptions)>(
    key: K,
    value: (HeaderOptions & FooterOptions)[K]
  ) => setConfig((prev) => ({ ...prev, [key]: value }));

  const submit = (form: HTMLFormElement) => {
    const data = new FormData(form);
    data.set("placement", placement);
    data.set("content", JSON.stringify(content));
    // Persist only the keys the placement actually uses — parsing through the
    // placement's schema strips the other group's keys.
    if (isHeader) {
      data.set("config", JSON.stringify(headerOptionsSchema.parse(config)));
    } else if (isFooter) {
      data.set("config", JSON.stringify(footerOptionsSchema.parse(config)));
    }
    submittedRef.current = true;
    fetcher.submit(data, { method: "post", ...(action ? { action } : {}) });
  };

  // Close once our save resolves successfully.
  useEffect(() => {
    if (
      submittedRef.current &&
      fetcher.state === "idle" &&
      fetcher.data?.success
    ) {
      submittedRef.current = false;
      onClose();
    }
  }, [fetcher.state, fetcher.data, onClose]);

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalContent>
        <fetcher.Form
          method="post"
          onSubmit={(e) => {
            e.preventDefault();
            submit(e.currentTarget);
          }}
        >
          {section && <input type="hidden" name="id" value={section.id} />}
          <ModalHeader>
            <ModalTitle>
              {section ? "Edit section" : "New shared section"}
            </ModalTitle>
          </ModalHeader>
          <ModalBody>
            <VStack spacing={4}>
              <div className="flex w-full flex-col gap-1.5">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  name="name"
                  defaultValue={section?.name ?? ""}
                  autoFocus
                  required
                />
              </div>
              <div className="flex w-full flex-col gap-1.5">
                <Label>Placement</Label>
                {lockPlacement ? (
                  <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
                    {PLACEMENT_LABELS[placement]}
                  </div>
                ) : (
                  <Select
                    value={placement}
                    onValueChange={(v) =>
                      setPlacement(v as DocumentSectionPlacement)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="body">Body section</SelectItem>
                      <SelectItem value="header">Page header</SelectItem>
                      <SelectItem value="footer">Page footer</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </div>

              {isHeader && (
                <div className="flex w-full flex-col gap-3 rounded-md border bg-muted/30 p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Header layout
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Set the logo from the Logo item under Header.
                  </p>
                  <ConfigSwitch
                    label="Show company address"
                    checked={config.showCompanyDetails}
                    onChange={(v) => setConfigKey("showCompanyDetails", v)}
                  />
                  <ConfigSwitch
                    label="Show document title"
                    checked={config.showDocumentTitle}
                    onChange={(v) => setConfigKey("showDocumentTitle", v)}
                  />
                  <ConfigSwitch
                    label="Show document number"
                    checked={config.showDocumentId}
                    onChange={(v) => setConfigKey("showDocumentId", v)}
                  />
                </div>
              )}

              {isFooter && (
                <div className="flex w-full flex-col gap-3 rounded-md border p-3">
                  <ConfigSwitch
                    label="Registration line"
                    checked={config.showRegistrationLine}
                    onChange={(v) => setConfigKey("showRegistrationLine", v)}
                  />
                  {config.showRegistrationLine && (
                    <div className="flex w-full flex-col gap-1.5">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="registrationNumber">
                          Registration number
                        </Label>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="secondary"
                              size="sm"
                              className="shrink-0"
                            >
                              Insert field
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {COMPANY_MERGE_FIELDS.map((field) => (
                              <DropdownMenuItem
                                key={field.token}
                                onClick={() =>
                                  setConfigKey(
                                    "registrationNumber",
                                    config.registrationNumber +
                                      mergeToken(field.token)
                                  )
                                }
                              >
                                {field.label}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                      <Input
                        id="registrationNumber"
                        value={config.registrationNumber}
                        onChange={(e) =>
                          setConfigKey("registrationNumber", e.target.value)
                        }
                      />
                      <p className="text-xs text-muted-foreground">
                        Shown on{" "}
                        {REGISTRATION_LINE_DOCUMENT_TYPES.map(
                          getDocumentLabel
                        ).join(", ")}{" "}
                        documents.
                      </p>
                    </div>
                  )}
                </div>
              )}

              <div className="flex w-full flex-col gap-1.5">
                <Label>
                  {isHeader ? "Banner content (optional)" : "Content"}
                </Label>
                <Editor
                  className="min-h-[160px] w-full rounded-md border bg-background p-3"
                  initialValue={content}
                  onChange={setContent}
                  disableFileUpload
                />
              </div>
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" isLoading={isSaving} isDisabled={isSaving}>
              Save
            </Button>
          </ModalFooter>
        </fetcher.Form>
      </ModalContent>
    </Modal>
  );
}

function ConfigSwitch({
  label,
  checked,
  onChange
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm">{label}</span>
      <Switch
        variant="small"
        checked={checked}
        onCheckedChange={(v) => onChange(Boolean(v))}
      />
    </div>
  );
}
