import { cn } from "@carbon/react";
import { motion } from "framer-motion";
import {
  type ComponentPropsWithoutRef,
  type PropsWithChildren,
  forwardRef,
} from "react";
import useMeasure from "react-use-measure";

type AnimatedSizeContainerProps = PropsWithChildren<{
  width?: boolean;
  height?: boolean;
}> &
  Omit<ComponentPropsWithoutRef<typeof motion.div>, "animate" | "children">;

/**
 * A container with animated width and height (each optional) based on children dimensions
 */
const AnimatedSizeContainer = forwardRef<
  HTMLDivElement,
  AnimatedSizeContainerProps
>(
  (
    {
      width = false,
      height = false,
      className,
      transition,
      children,
      ...rest
    }: AnimatedSizeContainerProps,
    forwardedRef
  ) => {
    const [containerRef, bounds] = useMeasure();

    return (
      <motion.div
        ref={forwardedRef}
        className={cn("overflow-hidden p-1", className)}
        animate={{
          width: width ? bounds?.width ?? "auto" : "auto",
          height: height ? bounds?.height ?? "auto" : "auto",
        }}
        transition={transition ?? { type: "spring", duration: 0.3 }}
        {...rest}
      >
        <div
          ref={containerRef}
          className={cn(height && "h-max", width && "w-max")}
        >
          {children}
        </div>
      </motion.div>
    );
  }
);

AnimatedSizeContainer.displayName = "AnimatedSizeContainer";

export { AnimatedSizeContainer };
