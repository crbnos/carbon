import type { ComponentPropsWithoutRef, RefCallback, RefObject } from "react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Button, type ButtonProps } from "./Button";
import { cn } from "./utils/cn";

type Position = { x: number; y: number };
type Dimensions = {
  height: number;
  width: number;
  screenHeight: number;
  screenWidth: number;
};

type ActionBarProps = ComponentPropsWithoutRef<"div"> & {
  open: boolean;
  maxWidth?: number;
  offsetBottom?: number;
  /**
   * Reference to the container element that the `ActionBar` should be initially rendered centered to.
   */
  containerRef?: RefObject<HTMLDivElement>;
};

const Component = ({ open, ...props }: ActionBarProps) => {
  if (!open) return null;

  return <ActionBar {...props} />;
};

const ActionBar = ({
  className,
  children,
  containerRef,
  maxWidth = 900,
  offsetBottom = 50,
}: Omit<ActionBarProps, "open">) => {
  const { ref } = useActionBar({
    containerRef,
    offsetBottom,
  });

  return (
    <div
      ref={ref}
      style={{
        maxWidth,
      }}
      className={cn(
        "tw-flex tw-text-white tw-bg-light-900 dark:tw-text-black dark:bg-light-50 tw-w-auto tw-items-center tw-fixed tw-shadow-xl tw-rounded-md tw-p-2 tw-cursor-move tw-z-50",
        className
      )}
    >
      {children}
    </div>
  );
};

const ActionBarButton = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ children, className, ...props }, ref) => {
    return (
      <Button
        className={cn(className, "tw-bg-transparent hover:tw-bg-white/10")}
        ref={ref}
        {...props}
        data-action-bar-button
        onMouseDown={(e) => {
          e.stopPropagation();
          props.onMouseDown?.(e);
        }}
      >
        {children}
      </Button>
    );
  }
);
ActionBarButton.displayName = "ActionBarButton";

export { Component as ActionBar, ActionBarButton };

const throttle = (f: (e: PointerEvent) => void) => {
  let frameId: number | null = null,
    lastArgs: PointerEvent;
  const invoke = () => {
    f(lastArgs);
    frameId = null;
  };
  const result = (args: PointerEvent) => {
    lastArgs = args;
    if (!frameId) {
      frameId = requestAnimationFrame(invoke);
    }
  };
  result.cancel = () => frameId && cancelAnimationFrame(frameId);
  return result;
};

const useRefEffect = (handler: Function): RefCallback<any> => {
  const storedValue = useRef<any>();
  const unsubscribe = useRef<Function | undefined>();
  const result = useCallback(
    (value: any) => {
      storedValue.current = value;
      if (unsubscribe.current) {
        unsubscribe.current();
        unsubscribe.current = undefined;
      }
      if (value) {
        unsubscribe.current = handler(value);
      }
    },
    [handler]
  );
  useEffect(() => {
    result(storedValue.current);
  }, [result]);
  return result;
};

// combine several `ref`s into one
// list of refs is supposed to be immutable after first render
const useCombinedRef = (
  refs: Array<React.MutableRefObject<any> | React.LegacyRef<any>>
): RefCallback<any> => {
  const initialRefs = useRef(refs);
  return useCallback((value: any) => {
    initialRefs.current.forEach((ref) => {
      if (typeof ref === "function") {
        ref(value);
      } else if (ref !== null) {
        (ref as React.MutableRefObject<any | null>).current = value;
      }
    });
  }, []);
};

// create a ref to subscribe to given element's event
const useDomEvent = (
  name: keyof WindowEventMap,
  handler: EventListenerOrEventListenerObject
) => {
  return useCallback(
    (elem: HTMLElement) => {
      elem.addEventListener(name, handler);
      return () => {
        elem.removeEventListener(name, handler);
      };
    },
    [name, handler]
  );
};

// callback with persistent reference,
// but updated on every render
const usePersistentCallback = (f: Function) => {
  const realF = useRef<Function>(f);
  useEffect(() => {
    realF.current = f;
  }, [f]);
  return useCallback((...args: any[]) => {
    return realF.current(...args);
  }, []);
};

// make element draggable
// returns [ref, isDragging, position]
// position doesn't update while dragging
// position is relative to initial position
const useDraggable = ({
  offsetBottom,
  boundingRect,
  onDrag,
}: {
  offsetBottom: number;
  boundingRect?: DOMRect;
  onDrag: (s: Dimensions) => (p: Position) => void;
}): [RefCallback<any>, boolean, Position] => {
  const screenDimensions = useWindowDimensions();
  const [isDragging, setIsDragging] = useState(false);
  const [position, setPosition] = useState<Position>({
    x: Infinity,
    y: Infinity,
  });
  const [dimensions, setDimensions] = useState<Dimensions>({
    height: 0,
    width: 0,
    screenHeight: screenDimensions.y,
    screenWidth: screenDimensions.x,
  });

  const ref = useRef<HTMLElement>();

  useEffect(() => {
    if (!ref.current) return;
    const elem = ref.current;
    const height = elem.offsetHeight;
    const width = elem.offsetWidth;

    const updatePosition = () => {
      let posX, posY;

      if (boundingRect) {
        posX = boundingRect.x + (boundingRect.width - width) / 2;
        posY = boundingRect.y + boundingRect.height - height;
      } else {
        posX = (screenDimensions.x - width) / 2;
        posY = screenDimensions.y - height;
      }

      const newPosition = {
        x: posX,
        y: posY - offsetBottom,
      };

      setPosition(newPosition);
      elem.style.left = `${newPosition.x}px`;
      elem.style.top = `${newPosition.y}px`;
    };

    updatePosition();

    setDimensions({
      height,
      width,
      screenHeight: screenDimensions.y,
      screenWidth: screenDimensions.x,
    });

    // Throttle the updatePosition function
    const throttledUpdatePosition = throttle(updatePosition);

    // Update position on window resize
    window.addEventListener("resize", (event: UIEvent) => {
      throttledUpdatePosition(event as unknown as PointerEvent);
    });

    return () => {
      window.removeEventListener(
        "resize",
        throttledUpdatePosition as unknown as EventListener
      );
      throttledUpdatePosition.cancel(); // Cancel any pending calls
    };
  }, [boundingRect, offsetBottom, screenDimensions.x, screenDimensions.y]);

  const subscribeMouseDown = useDomEvent("pointerdown", (e: Event) => {
    const event = e as PointerEvent;
    const target = event.target as HTMLElement;
    if (!target.hasAttribute("data-action-bar-button")) {
      e.preventDefault();
      setIsDragging(true);
    }
  });
  const ref2 = useRefEffect(subscribeMouseDown);
  const combinedRef = useCombinedRef([ref, ref2]);
  const onDragWithCurriedDimensions = useCallback(
    (delta: Position) => {
      return onDrag({
        width: dimensions.width,
        height: dimensions.height,
        screenHeight: dimensions.screenHeight,
        screenWidth: dimensions.screenWidth,
      })(delta);
    },
    [
      onDrag,
      dimensions.width,
      dimensions.height,
      dimensions.screenHeight,
      dimensions.screenWidth,
    ]
  );

  const persistentOnDrag = usePersistentCallback(onDragWithCurriedDimensions);

  useEffect(() => {
    if (!isDragging) {
      return;
    }
    let delta = position,
      lastPosition = position;
    const applyTransform = () => {
      if (!ref.current) {
        return;
      }
      const { x, y } = lastPosition;
      ref.current.style.left = `${x}px`;
      ref.current.style.top = `${y}px`;
      ref.current.style.pointerEvents = "none"; // Add this line
    };
    const handleMouseMove = throttle((e: PointerEvent) => {
      e.preventDefault();
      const { x, y } = delta;
      delta = { x: x + e.movementX, y: y + e.movementY };
      lastPosition = persistentOnDrag(delta);
      applyTransform();
    });
    const handleMouseUp = (e: PointerEvent) => {
      handleMouseMove(e);
      setIsDragging(false);
      setPosition(lastPosition);
      if (ref.current) {
        ref.current.style.pointerEvents = "auto"; // don't highlight text as we drag
      }
    };
    const terminate = () => {
      lastPosition = position;
      applyTransform();
      setIsDragging(false);
      if (ref.current) {
        ref.current.style.pointerEvents = "auto"; // don't highlight text as we drag
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Escape") {
        e.preventDefault();
        terminate();
      }
    };
    document.addEventListener("pointermove", handleMouseMove);
    document.addEventListener("pointerup", handleMouseUp);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("blur", terminate);
    return () => {
      handleMouseMove.cancel();
      document.removeEventListener("pointermove", handleMouseMove);
      document.removeEventListener("pointerup", handleMouseUp);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("blur", terminate);
    };
  }, [position, isDragging, persistentOnDrag]);

  return [combinedRef, isDragging, position];
};

const useWindowDimensions = () => {
  const [windowDimensions, setWindowDimensions] = useState<Position>({
    x: window.innerWidth,
    y: window.innerHeight,
  });

  const onResize = useCallback(() => {
    setWindowDimensions({
      x: window.innerWidth,
      y: window.innerHeight,
    });
  }, []);

  useEffect(() => {
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [onResize]);

  return windowDimensions;
};

type UseActionBarProps = {
  offsetBottom?: number;
  containerRef?: RefObject<HTMLDivElement>;
};

export default function useActionBar({
  offsetBottom = 50,
  containerRef,
}: UseActionBarProps) {
  const onDrag = useCallback(
    ({ height, width, screenHeight, screenWidth }: Dimensions) =>
      ({ x, y }: Position) => {
        return {
          x: Math.max(0, Math.min(x, screenWidth - width)),
          y: Math.max(0, Math.min(y, screenHeight - height)),
        };
      },
    []
  );

  const boundingRect = useMemo(
    () => containerRef?.current?.getBoundingClientRect(),
    [containerRef]
  );

  const [ref, isDragging, position] = useDraggable({
    boundingRect,
    offsetBottom,
    onDrag,
  });

  return {
    ref,
    isDragging,
    position,
  };
}
