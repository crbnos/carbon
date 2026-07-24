import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuBookmarkPlus, LuChevronDown, LuTrash } from "react-icons/lu";
import { useFetcher, useNavigate } from "react-router";
import { useUrlParams } from "~/hooks";
import type { ReportView } from "~/modules/accounting";
import { path } from "~/utils/path";

type ReportViewsMenuProps = {
  report: string;
  views: ReportView[];
};

// Personal saved report views: apply (navigate with the saved params), delete,
// and save the current filter set. Backed by the report-views resource route.
const ReportViewsMenu = ({ report, views }: ReportViewsMenuProps) => {
  const { t } = useLingui();
  const navigate = useNavigate();
  const [params] = useUrlParams();
  const fetcher = useFetcher();
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState("");

  const apply = (view: ReportView) => {
    navigate({ search: new URLSearchParams(view.params).toString() });
  };

  const remove = (id: string) => {
    const formData = new FormData();
    formData.set("intent", "delete");
    formData.set("id", id);
    fetcher.submit(formData, { method: "post", action: path.to.reportViews });
  };

  const save = () => {
    if (!name.trim()) return;
    const formData = new FormData();
    formData.set("intent", "save");
    formData.set("report", report);
    formData.set("name", name.trim());
    formData.set(
      "params",
      JSON.stringify(Object.fromEntries(params.entries()))
    );
    fetcher.submit(formData, { method: "post", action: path.to.reportViews });
    setSaveOpen(false);
    setName("");
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" rightIcon={<LuChevronDown />}>
            {t`Views`}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {views.length === 0 && (
            <DropdownMenuItem disabled>{t`No saved views`}</DropdownMenuItem>
          )}
          {views.map((view) => (
            <DropdownMenuItem
              key={view.id}
              onSelect={() => apply(view)}
              className="flex items-center justify-between gap-2"
            >
              <span className="truncate">{view.name}</span>
              <IconButton
                aria-label={t`Delete view`}
                variant="ghost"
                size="sm"
                icon={<LuTrash />}
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  remove(view.id);
                }}
              />
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              setSaveOpen(true);
            }}
          >
            <LuBookmarkPlus className="mr-2 h-4 w-4" />
            {t`Save current view…`}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Modal open={saveOpen} onOpenChange={setSaveOpen}>
        <ModalContent size="small">
          <ModalHeader>
            <ModalTitle>{t`Save view`}</ModalTitle>
          </ModalHeader>
          <ModalBody>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t`View name`}
              autoFocus
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={() => setSaveOpen(false)}>
              {t`Cancel`}
            </Button>
            <Button onClick={save} isDisabled={!name.trim()}>
              {t`Save`}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
};

export default ReportViewsMenu;
