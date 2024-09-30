import {
  Modal,
  ModalContent,
  ResizableHandle,
  ResizablePanel,
} from "@carbon/react";
import type { PropsWithChildren } from "react";
import { defaultLayout } from "~/utils/layout";

interface OptionallyFullscreenProps {
  isFullScreen: boolean;
  onClose: () => void;
}

export const OptionallyFullscreen = ({
  children,
  isFullScreen,
  onClose,
}: PropsWithChildren<OptionallyFullscreenProps>) => {
  return (
    <>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize={defaultLayout[2]} className="relative">
        {children}
      </ResizablePanel>
      {isFullScreen && (
        <Modal
          open={isFullScreen}
          onOpenChange={(open) => {
            if (!open) onClose();
          }}
        >
          <ModalContent className="min-w-full h-screen py-2">
            {children}
          </ModalContent>
        </Modal>
      )}
    </>
  );
};
