/*
  ModalCard components are an abstraction over Card and Modal components.
*/
import type {
  ComponentPropsWithoutRef,
  ElementRef,
  PropsWithChildren,
} from "react";
import { createContext, forwardRef, useContext } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./Card";

import {
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from "./Modal";

const ModalCardTypeContext = createContext<"card" | "modal">("card");
const ModalCardTypeProvider = ModalCardTypeContext.Provider;

const ModalCardProvider = ({
  type = "card",
  ...props
}: PropsWithChildren<{
  type?: "card" | "modal";
}>) => <ModalCardTypeProvider value={type} {...props} />;

const useModalCardType = () => {
  const type = useContext(ModalCardTypeContext);
  return type;
};

const ModalCard = forwardRef<
  ElementRef<typeof Modal> | ElementRef<typeof Card>,
  | (ComponentPropsWithoutRef<typeof Modal> & {
      onClose?: () => void;
    })
  | (ComponentPropsWithoutRef<typeof Card> & {
      onClose?: () => void;
    })
>(({ onClose, ...props }, ref) => {
  const type = useModalCardType();

  if (type === "card") {
    return <Card {...props} ref={ref} />;
  }

  return (
    <Modal
      {...props}
      onOpenChange={(open) => {
        if (!open) {
          onClose?.();
        }
      }}
      open
    />
  );
});
ModalCard.displayName = "ModalCard";

const ModalCardBody = forwardRef<
  ElementRef<typeof ModalBody> | ElementRef<typeof CardContent>,
  | ComponentPropsWithoutRef<typeof ModalBody>
  | ComponentPropsWithoutRef<typeof CardContent>
>((props, ref) => {
  const type = useModalCardType();

  if (type === "card") {
    return <CardContent {...props} ref={ref} />;
  }

  return <ModalBody {...props} />;
});
ModalCardBody.displayName = "ModalCardBody";

const ModalCardContent = forwardRef<
  ElementRef<typeof ModalContent> | ElementRef<"div">,
  | ComponentPropsWithoutRef<typeof ModalContent>
  | ComponentPropsWithoutRef<"div">
>((props, ref) => {
  const type = useModalCardType();

  if (type === "card") {
    return <div {...props} ref={ref} />;
  }

  return <ModalContent {...props} size="xlarge" ref={ref} />;
});
ModalCardContent.displayName = "ModalCardContent";

const ModalCardDescription = forwardRef<
  ElementRef<typeof ModalDescription> | ElementRef<typeof CardDescription>,
  | ComponentPropsWithoutRef<typeof ModalDescription>
  | ComponentPropsWithoutRef<typeof CardDescription>
>((props, ref) => {
  const type = useModalCardType();

  if (type === "card") {
    return <CardDescription {...props} ref={ref} />;
  }

  return <ModalDescription {...props} ref={ref} />;
});
ModalCardDescription.displayName = "ModalCardDescription";

const ModalCardFooter = forwardRef<
  ElementRef<typeof ModalFooter> | ElementRef<typeof CardFooter>,
  | ComponentPropsWithoutRef<typeof ModalFooter>
  | ComponentPropsWithoutRef<typeof CardFooter>
>((props, ref) => {
  const type = useModalCardType();

  if (type === "card") {
    return <CardFooter {...props} ref={ref} />;
  }

  return <ModalFooter {...props} />;
});
ModalCardFooter.displayName = "ModalCardFooter";

const ModalCardHeader = forwardRef<
  ElementRef<typeof ModalHeader> | ElementRef<typeof CardHeader>,
  | ComponentPropsWithoutRef<typeof ModalHeader>
  | ComponentPropsWithoutRef<typeof CardHeader>
>((props, ref) => {
  const type = useModalCardType();

  if (type === "card") {
    return <CardHeader {...props} ref={ref} />;
  }

  return <ModalHeader {...props} />;
});
ModalCardHeader.displayName = "ModalCardHeader";

const ModalCardTitle = forwardRef<
  ElementRef<typeof ModalTitle> | ElementRef<typeof CardTitle>,
  | ComponentPropsWithoutRef<typeof ModalTitle>
  | ComponentPropsWithoutRef<typeof CardTitle>
>((props, ref) => {
  const type = useModalCardType();

  if (type === "card") {
    return <CardTitle {...props} ref={ref} />;
  }

  return <ModalTitle {...props} ref={ref} />;
});
ModalCardTitle.displayName = "ModalCardTitle";

export {
  ModalCard,
  ModalCardBody,
  ModalCardContent,
  ModalCardDescription,
  ModalCardFooter,
  ModalCardHeader,
  ModalCardProvider,
  ModalCardTitle,
  ModalCardTypeContext,
  ModalCardTypeProvider,
  useModalCardType,
};
