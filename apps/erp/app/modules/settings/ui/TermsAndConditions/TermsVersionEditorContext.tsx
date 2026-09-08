import type { JSONContent } from "@carbon/react";
import {
  Button,
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  toast
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { useBlocker, useFetcher } from "react-router";
import { path } from "~/utils/path";

type TermsVersionEditorState = {
  name: string;
  setName: (name: string) => void;
  content: JSONContent;
  setContent: (content: JSONContent) => void;
  isDirty: boolean;
  isSaving: boolean;
  save: () => void;
};

const TermsVersionEditorContext = createContext<TermsVersionEditorState | null>(
  null
);

export function useTermsVersionEditor() {
  const context = useContext(TermsVersionEditorContext);
  if (!context)
    throw new Error(
      "useTermsVersionEditor must be used within a TermsVersionEditorProvider"
    );
  return context;
}

/**
 * The name + body of a terms version are saved EXPLICITLY (the header's Save
 * button), unlike the properties panel, whose discrete controls each save on
 * change. That is what makes an unsaved-changes warning meaningful: with the
 * old debounced autosave the dirty window was 500 ms and nothing could be lost.
 *
 * Dirty is a comparison against the last SAVED snapshot rather than a flag, so
 * typing something and undoing it leaves the version clean.
 */
export function TermsVersionEditorProvider({
  id,
  initialName,
  initialContent,
  children
}: {
  id: string;
  initialName: string;
  initialContent: JSONContent;
  children: ReactNode;
}) {
  const [name, setName] = useState(initialName);
  const [content, setContent] = useState<JSONContent>(initialContent);

  const [saved, setSaved] = useState(() => ({
    name: initialName,
    content: JSON.stringify(initialContent ?? {})
  }));

  const fetcher = useFetcher<{ error?: { message: string } | null }>();
  const isSaving = fetcher.state !== "idle";

  const serializedContent = useMemo(
    () => JSON.stringify(content ?? {}),
    [content]
  );
  const isDirty = name !== saved.name || serializedContent !== saved.content;

  // What the in-flight submit will make the saved state, applied when it lands.
  const pending = useRef<{ name: string; content: string } | null>(null);

  const save = useCallback(() => {
    if (!isDirty || isSaving) return;
    const snapshot = { name, content: serializedContent };
    pending.current = snapshot;

    const formData = new FormData();
    formData.append("id", id);
    formData.append("field", "editor");
    formData.append("name", snapshot.name);
    formData.append("content", snapshot.content);
    fetcher.submit(formData, {
      method: "post",
      action: path.to.bulkUpdateTermsVersion
    });
  }, [fetcher, id, isDirty, isSaving, name, serializedContent]);

  useEffect(() => {
    if (fetcher.state !== "idle" || !pending.current) return;
    if (fetcher.data?.error) {
      toast.error(fetcher.data.error.message);
      pending.current = null;
      return;
    }
    setSaved(pending.current);
    pending.current = null;
  }, [fetcher.state, fetcher.data]);

  // Refresh / close / external link — the browser shows its own generic prompt.
  useEffect(() => {
    if (!isDirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty]);

  // In-app navigation — same modal the shared Submit button uses.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      isDirty && currentLocation.pathname !== nextLocation.pathname
  );

  const value = useMemo(
    () => ({ name, setName, content, setContent, isDirty, isSaving, save }),
    [name, content, isDirty, isSaving, save]
  );

  return (
    <TermsVersionEditorContext.Provider value={value}>
      {children}
      {blocker.state === "blocked" && (
        <Modal open onOpenChange={(open) => !open && blocker.reset()}>
          <ModalContent>
            <ModalHeader>
              <ModalTitle>
                <Trans>Unsaved changes</Trans>
              </ModalTitle>
              <ModalDescription>
                <Trans>Are you sure you want to leave this page?</Trans>
              </ModalDescription>
            </ModalHeader>
            <ModalFooter>
              <Button variant="secondary" onClick={() => blocker.reset()}>
                <Trans>Stay on this page</Trans>
              </Button>
              <Button onClick={() => blocker.proceed()}>
                <Trans>Leave this page</Trans>
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      )}
    </TermsVersionEditorContext.Provider>
  );
}
