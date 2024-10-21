/*
  ModalDrawer components are an abstraction over Drawer and Modal components.
*/
import type {
  ComponentPropsWithoutRef,
  ElementRef,
  PropsWithChildren,
} from "react";
import { createContext, forwardRef, useContext } from "react";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "./Drawer";

import {
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from "./Modal";

const ModalDrawerTypeContext = createContext<"drawer" | "modal">("drawer");
const ModalDrawerTypeProvider = ModalDrawerTypeContext.Provider;

const ModalDrawerProvider = ({
  type = "drawer",
  ...props
}: PropsWithChildren<{
  type?: "drawer" | "modal";
}>) => <ModalDrawerTypeProvider value={type} {...props} />;

const useModalDrawerType = () => {
  const type = useContext(ModalDrawerTypeContext);
  return type;
};

const ModalDrawer = forwardRef<
  ElementRef<typeof Modal> | ElementRef<typeof Drawer>,
  | ComponentPropsWithoutRef<typeof Modal>
  | ComponentPropsWithoutRef<typeof Drawer>
>((props, ref) => {
  const type = useModalDrawerType();

  if (type === "drawer") {
    return <Drawer {...props} />;
  }

  return <Modal {...props} />;
});
ModalDrawer.displayName = "ModalDrawer";

const ModalDrawerBody = forwardRef<
  ElementRef<typeof ModalBody> | ElementRef<typeof DrawerBody>,
  | ComponentPropsWithoutRef<typeof ModalBody>
  | ComponentPropsWithoutRef<typeof DrawerBody>
>((props, ref) => {
  const type = useModalDrawerType();

  if (type === "drawer") {
    return <DrawerBody {...props} />;
  }

  return <ModalBody {...props} />;
});
ModalDrawerBody.displayName = "ModalDrawerBody";

const ModalDrawerContent = forwardRef<
  ElementRef<typeof ModalContent> | ElementRef<typeof DrawerContent>,
  ComponentPropsWithoutRef<typeof DrawerContent>
>(({ size, ...props }, ref) => {
  const type = useModalDrawerType();

  if (type === "drawer") {
    return <DrawerContent {...props} size={size} ref={ref} />;
  }

  return <ModalContent {...props} size="medium" ref={ref} />;
});
ModalDrawerContent.displayName = "ModalDrawerContent";

const ModalDrawerDescription = forwardRef<
  ElementRef<typeof ModalDescription> | ElementRef<typeof DrawerDescription>,
  | ComponentPropsWithoutRef<typeof ModalDescription>
  | ComponentPropsWithoutRef<typeof DrawerDescription>
>((props, ref) => {
  const type = useModalDrawerType();

  if (type === "drawer") {
    return <DrawerDescription {...props} ref={ref} />;
  }

  return <ModalDescription {...props} ref={ref} />;
});
ModalDrawerDescription.displayName = "ModalDrawerDescription";

const ModalDrawerFooter = forwardRef<
  ElementRef<typeof ModalFooter> | ElementRef<typeof DrawerFooter>,
  | ComponentPropsWithoutRef<typeof ModalFooter>
  | ComponentPropsWithoutRef<typeof DrawerFooter>
>((props, ref) => {
  const type = useModalDrawerType();

  if (type === "drawer") {
    return <DrawerFooter {...props} />;
  }

  return <ModalFooter {...props} />;
});
ModalDrawerFooter.displayName = "ModalDrawerFooter";

const ModalDrawerHeader = forwardRef<
  ElementRef<typeof ModalHeader> | ElementRef<typeof DrawerHeader>,
  | ComponentPropsWithoutRef<typeof ModalHeader>
  | ComponentPropsWithoutRef<typeof DrawerHeader>
>((props, ref) => {
  const type = useModalDrawerType();

  if (type === "drawer") {
    return <DrawerHeader {...props} />;
  }

  return <ModalHeader {...props} />;
});
ModalDrawerHeader.displayName = "ModalDrawerHeader";

const ModalDrawerTitle = forwardRef<
  ElementRef<typeof ModalTitle> | ElementRef<typeof DrawerTitle>,
  | ComponentPropsWithoutRef<typeof ModalTitle>
  | ComponentPropsWithoutRef<typeof DrawerTitle>
>((props, ref) => {
  const type = useModalDrawerType();

  if (type === "drawer") {
    return <DrawerTitle {...props} ref={ref} />;
  }

  return <ModalTitle {...props} ref={ref} />;
});
ModalDrawerTitle.displayName = "ModalDrawerTitle";

export {
  ModalDrawer,
  ModalDrawerBody,
  ModalDrawerContent,
  ModalDrawerDescription,
  ModalDrawerFooter,
  ModalDrawerHeader,
  ModalDrawerProvider,
  ModalDrawerTitle,
  ModalDrawerTypeContext,
  ModalDrawerTypeProvider,
  useModalDrawerType,
};
