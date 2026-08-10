import { useEffect, useRef } from "react";
import useCallbackRef from "./useCallbackRef";

export interface Props {
  enabled?: boolean;
  ref: React.RefObject<HTMLElement>;
  handler?: (e: Event) => void;
  /**
   * Fire on the press rather than the release. Needed inside a surface that swallows
   * `mouseup` — React Flow's canvas stops it at window capture, so a press-and-release
   * pair never completes and the default never fires at all.
   */
  immediate?: boolean;
}

export default function useOutsideClick({
  ref,
  handler,
  enabled = true,
  immediate = false
}: Props) {
  const savedHandler = useCallbackRef(handler);

  const stateRef = useRef({
    isPointerDown: false,
    ignoreEmulatedMouseEvents: false
  });

  const state = stateRef.current;

  useEffect(() => {
    if (!enabled) return;
    const onPointerDown: any = (e: PointerEvent) => {
      if (!isValidEvent(e, ref)) return;
      if (immediate) {
        savedHandler(e);
        return;
      }
      state.isPointerDown = true;
    };

    const onMouseUp: any = (event: MouseEvent) => {
      if (state.ignoreEmulatedMouseEvents) {
        state.ignoreEmulatedMouseEvents = false;
        return;
      }

      if (state.isPointerDown && handler && isValidEvent(event, ref)) {
        state.isPointerDown = false;
        savedHandler(event);
      }
    };

    const onTouchEnd = (event: TouchEvent) => {
      state.ignoreEmulatedMouseEvents = true;
      if (handler && state.isPointerDown && isValidEvent(event, ref)) {
        state.isPointerDown = false;
        savedHandler(event);
      }
    };

    const doc = getOwnerDocument(ref.current);
    doc.addEventListener("mousedown", onPointerDown, true);
    doc.addEventListener("mouseup", onMouseUp, true);
    doc.addEventListener("touchstart", onPointerDown, true);
    doc.addEventListener("touchend", onTouchEnd, true);

    return () => {
      doc.removeEventListener("mousedown", onPointerDown, true);
      doc.removeEventListener("mouseup", onMouseUp, true);
      doc.removeEventListener("touchstart", onPointerDown, true);
      doc.removeEventListener("touchend", onTouchEnd, true);
    };
  }, [handler, ref, savedHandler, state, enabled, immediate]);
}

function isValidEvent(event: Event, ref: React.RefObject<HTMLElement>) {
  const target = event.target as HTMLElement;

  if (target) {
    const doc = getOwnerDocument(target);
    if (!doc.contains(target)) return false;
  }

  return !ref.current?.contains(target);
}

function getOwnerDocument(node?: Element | null): Document {
  return node?.ownerDocument ?? document;
}
