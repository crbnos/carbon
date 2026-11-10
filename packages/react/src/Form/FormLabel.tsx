// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Trans } from "@lingui/react/macro";
import type { ComponentPropsWithoutRef, ElementRef } from "react";
import { forwardRef, useRef } from "react";
import { LuSquareFunction } from "react-icons/lu";
import { useIsomorphicLayoutEffect } from "../hooks/useIsomorphicLayoutEffect";
import { cn } from "../utils/cn";
import { useFormControlContext } from "./FormControl";

/**
 * The words a label shows, read from the DOM: a `<Trans>` label compiles to an
 * element without `children`, so its text only exists once rendered. Help
 * text (aria-hidden glossary copy, sr-only hints) is not part of the name.
 */
function visibleLabelText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (!(node instanceof Element)) return "";
  if (
    node.getAttribute("aria-hidden") === "true" ||
    node.classList.contains("sr-only")
  ) {
    return "";
  }
  return Array.from(node.childNodes).map(visibleLabelText).join("");
}

export const FormLabel = forwardRef<
  ElementRef<"label">,
  ComponentPropsWithoutRef<"label"> & {
    isOptional?: boolean;
    isConfigured?: boolean;
    onConfigure?: () => void;
  }
>((props, ref) => {
  const {
    className,
    children,
    isConfigured = false,
    isOptional = false,
    onConfigure,
    ...rest
  } = props;

  const field = useFormControlContext();
  const labelProps = field?.getLabelProps(rest, ref) ?? { ref, ...rest };

  const textRef = useRef<HTMLSpanElement>(null);
  const setLabelText = field?.setLabelText;
  useIsomorphicLayoutEffect(() => {
    const node = textRef.current;
    if (!setLabelText || !node) return;
    const sync = () =>
      setLabelText(
        visibleLabelText(node).replace(/\s+/g, " ").trim() || undefined
      );
    sync();
    // The text can change without this component re-rendering (a `<Trans>`
    // child re-renders on its own when the locale changes).
    const observer = new MutationObserver(sync);
    observer.observe(node, {
      characterData: true,
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-hidden", "class"]
    });
    return () => {
      observer.disconnect();
      setLabelText(undefined);
    };
  }, [setLabelText]);

  return (
    <label
      {...labelProps}
      className="flex items-center justify-between max-md:gap-2"
    >
      <span
        ref={textRef}
        className={cn("text-xs font-medium text-muted-foreground", className)}
      >
        {children}
      </span>
      {(isOptional || onConfigure) && (
        <div className="flex items-center gap-1 max-md:gap-2">
          {isOptional && (
            <span
              data-optional-tag
              className="text-muted-foreground text-xxs max-md:text-xs"
            >
              <Trans>Optional</Trans>
            </span>
          )}
          {onConfigure && (
            <LuSquareFunction
              aria-label="Configure"
              role="button"
              onClick={onConfigure}
              className={cn(
                "size-4",
                isConfigured
                  ? "text-emerald-500"
                  : "opacity-50 hover:opacity-100"
              )}
            />
          )}
        </div>
      )}
    </label>
  );
});

FormLabel.displayName = "FormLabel";
