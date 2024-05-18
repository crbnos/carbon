import * as RadixSlider from "@radix-ui/react-slider";
import { cloneElement, type ComponentProps, type ReactElement } from "react";
import { cn } from "./utils/cn";

const variants = {
  primary: {
    container: "h-6 gap-1 rounded-sm hover:bg-muted px-1",
    icons: "h-4 w-4 text-foreground",
    root: "h-4",
    track: "h-1 bg-accent group-hover:bg-secondary",
    range: "bg-transparent group-hover:bg-primary",
    thumb: "h-3 w-3 border-2 border-primary bg-background shadow-md",
  },
};

type VariantName = keyof typeof variants;

export type SliderProps = ComponentProps<typeof RadixSlider.Root> & {
  leftIcon?: ReactElement;
  rightIcon?: ReactElement;
  variant: VariantName;
};

export function Slider({
  variant,
  className,
  leftIcon,
  rightIcon,
  ...props
}: SliderProps) {
  const variation = variants[variant];
  return (
    <div className={cn("group flex items-center", variation.container)}>
      {leftIcon &&
        cloneElement(leftIcon, {
          className: !leftIcon.props?.size
            ? cn("mr-2 h-4 w-4", leftIcon.props.className)
            : cn("mr-2", leftIcon.props.className),
        })}
      <RadixSlider.Root
        className={cn(
          "relative flex touch-none select-none items-center",
          variation.root,
          className
        )}
        {...props}
      >
        <RadixSlider.Track
          className={cn("relative grow rounded-full", variation.track)}
        >
          <RadixSlider.Range
            className={cn("absolute h-full rounded-full", variation.range)}
          />
        </RadixSlider.Track>
        <RadixSlider.Thumb
          className={cn(
            "block cursor-pointer rounded-full transition focus:outline-none",
            variation.thumb
          )}
        />
      </RadixSlider.Root>
      {rightIcon &&
        cloneElement(rightIcon, {
          className: !rightIcon.props?.size
            ? cn("ml-2 h-4 w-4", rightIcon.props.className)
            : cn("ml-2", rightIcon.props.className),
        })}
    </div>
  );
}
