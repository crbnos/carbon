// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useIsomorphicLayoutEffect } from "@carbon/react";
import type { RefObject } from "react";

import { useEffect, useRef } from "react";

// MediaQueryList Event based useEventListener interface
function useEventListener<K extends keyof MediaQueryListEventMap>(
  eventName: K,
  handler: (event: MediaQueryListEventMap[K]) => void,
  element: RefObject<MediaQueryList>,
  options?: boolean | AddEventListenerOptions
): void;

// Window Event based useEventListener interface
function useEventListener<K extends keyof WindowEventMap>(
  eventName: K,
  handler: (event: WindowEventMap[K]) => void,
  element?: undefined,
  options?: boolean | AddEventListenerOptions
): void;

// Element Event based useEventListener interface
function useEventListener<
  K extends keyof HTMLElementEventMap & keyof SVGElementEventMap,
  T extends Element = K extends keyof HTMLElementEventMap
    ? HTMLDivElement
    : SVGElement
>(
  eventName: K,
  handler:
    | ((event: HTMLElementEventMap[K]) => void)
    | ((event: SVGElementEventMap[K]) => void),
  element: RefObject<T>,
  options?: boolean | AddEventListenerOptions
): void;

// Document Event based useEventListener interface
function useEventListener<K extends keyof DocumentEventMap>(
  eventName: K,
  handler: (event: DocumentEventMap[K]) => void,
  element: RefObject<Document>,
  options?: boolean | AddEventListenerOptions
): void;

/**
 * Custom hook that attaches event listeners to DOM elements, the window, or media query lists.
 * @template KW - The type of event for window events.
 * @template KH - The type of event for HTML or SVG element events.
 * @template KM - The type of event for media query list events.
 * @template T - The type of the DOM element (default is `HTMLElement`).
 * @param {KW | KH | KM} eventName - The name of the event to listen for.
 * @param {(event: WindowEventMap[KW] | HTMLElementEventMap[KH] | SVGElementEventMap[KH] | MediaQueryListEventMap[KM] | Event) => void} handler - The event handler function.
 * @param {RefObject<T>} [element] - The DOM element or media query list to attach the event listener to (optional).
 * @param {boolean | AddEventListenerOptions} [options] - An options object that specifies characteristics about the event listener (optional).
 * @public
 * @see [Documentation](https://usehooks-ts.com/react-hook/use-event-listener)
 * @example
 * ```tsx
 * // Example 1: Attach a window event listener
 * useEventListener('resize', handleResize);
 * ```
 * @example
 * ```tsx
 * // Example 2: Attach a document event listener with options
 * const elementRef = useRef(document);
 * useEventListener('click', handleClick, elementRef, { capture: true });
 * ```
 * @example
 * ```tsx
 * // Example 3: Attach an element event listener
 * const buttonRef = useRef<HTMLButtonElement>(null);
 * useEventListener('click', handleButtonClick, buttonRef);
 * ```
 */
function useEventListener<
  KW extends keyof WindowEventMap,
  KH extends keyof HTMLElementEventMap & keyof SVGElementEventMap,
  KM extends keyof MediaQueryListEventMap,
  T extends HTMLElement | SVGAElement | MediaQueryList = HTMLElement
>(
  eventName: KW | KH | KM,
  handler: (
    event:
      | WindowEventMap[KW]
      | HTMLElementEventMap[KH]
      | SVGElementEventMap[KH]
      | MediaQueryListEventMap[KM]
      | Event
  ) => void,
  element?: RefObject<T>,
  options?: boolean | AddEventListenerOptions
) {
  // Create a ref that stores handler
  const savedHandler = useRef(handler);
  useIsomorphicLayoutEffect(() => {
    savedHandler.current = handler;
  }, [handler]);

  useEffect(() => {
    // Define the listening target
    const targetElement: T | Window = element?.current ?? window;

    if (!(targetElement && targetElement.addEventListener)) return;

    // Create event listener that calls handler function stored in ref
    const listener: typeof handler = (event) => {
      savedHandler.current(event);
    };

    targetElement.addEventListener(eventName, listener, options);

    // Remove event listener on cleanup
    return () => {
      targetElement.removeEventListener(eventName, listener, options);
    };
  }, [eventName, element, options]);
}

/** Supported event types. */
type EventType =
  | "mousedown"
  | "mouseup"
  | "touchstart"
  | "touchend"
  | "focusin"
  | "focusout";

/**
 * Custom hook that handles clicks outside a specified element.
 * @template T - The type of the element's reference.
 * @param {RefObject<T> | RefObject<T>[]} ref - The React ref object(s) representing the element(s) to watch for outside clicks.
 * @param {(event: MouseEvent | TouchEvent | FocusEvent) => void} handler - The callback function to be executed when a click outside the element occurs.
 * @param {EventType} [eventType] - The mouse event type to listen for (optional, default is 'mousedown').
 * @param {?AddEventListenerOptions} [eventListenerOptions] - The options object to be passed to the `addEventListener` method (optional).
 * @returns {void}
 * @public
 * @see [Documentation](https://usehooks-ts.com/react-hook/use-on-click-outside)
 * @example
 * ```tsx
 * const containerRef = useRef(null);
 * useOnClickOutside([containerRef], () => {
 *   // Handle clicks outside the container.
 * });
 * ```
 */
export function useOnClickOutside<T extends HTMLElement = HTMLElement>(
  ref: RefObject<T> | RefObject<T>[],
  handler: (event: MouseEvent | TouchEvent | FocusEvent) => void,
  eventType: EventType = "mousedown",
  eventListenerOptions: AddEventListenerOptions = {}
): void {
  useEventListener(
    eventType,
    (event) => {
      const target = event.target as Node;

      // Do nothing if the target is not connected element with document
      if (!target || !target.isConnected) {
        return;
      }

      const isOutside = Array.isArray(ref)
        ? ref
            .filter((r) => Boolean(r.current))
            .every((r) => r.current && !r.current.contains(target))
        : ref.current && !ref.current.contains(target);

      if (isOutside) {
        handler(event);
      }
    },
    undefined,
    eventListenerOptions
  );
}
