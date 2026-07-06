import {
  IconButton,
  Modal,
  ModalClose,
  ModalContent,
  ModalTitle,
  ModalTrigger
} from "@carbon/react";
import { LuExpand, LuX } from "react-icons/lu";

// The source screenshots are ~3400px wide — far more detail than the
// quickstart column can show — so the thumbnail opens a full-size lightbox.
export function Screenshot({ src, alt }: { src: string; alt: string }) {
  return (
    <Modal>
      <ModalTrigger asChild>
        <button
          type="button"
          className="group relative block w-full cursor-zoom-in rounded-[9px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--acc)]"
        >
          <img
            src={src}
            alt={alt}
            className="w-full rounded-[9px] block outline outline-1 outline-black/10 -outline-offset-1"
          />
          <span className="absolute top-[8px] right-[8px] w-[28px] h-[28px] inline-flex items-center justify-center rounded-md bg-zinc-800/80 text-zinc-300 backdrop-blur-sm transition-colors group-hover:bg-zinc-800 group-hover:text-zinc-100">
            <LuExpand size={14} />
            <span className="sr-only">Expand screenshot</span>
          </span>
        </button>
      </ModalTrigger>
      <ModalContent
        size="xxxlarge"
        withCloseButton={false}
        aria-describedby={undefined}
        className="pt-0 gap-0 overflow-hidden"
      >
        <ModalTitle className="sr-only">{alt}</ModalTitle>
        <img src={src} alt={alt} className="w-full block" />
        {/* The default close button is foreground-on-transparent — invisible
            over these mostly-dark screenshots. */}
        <ModalClose asChild>
          <IconButton
            aria-label="Close"
            icon={<LuX />}
            variant="secondary"
            className="absolute top-2 right-2"
          />
        </ModalClose>
      </ModalContent>
    </Modal>
  );
}
