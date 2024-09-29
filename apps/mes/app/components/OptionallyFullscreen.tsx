import {
  Modal,
  ModalContent,
  ResizableHandle,
  ResizablePanel,
} from "@carbon/react";
import type { ReactNode } from "react";
import { defaultLayout } from "~/utils/layout";

export const OptionallyFullscreen = ({
  children,
  isFullScreen,
  onClose,
}: {
  children: ReactNode;
  isFullScreen: boolean;
  onClose: () => void;
}) => {
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
