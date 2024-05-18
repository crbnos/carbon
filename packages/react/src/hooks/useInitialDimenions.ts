import { useEffect, useState } from "react";

export default function useInitialDimensions(
  ref: React.RefObject<HTMLElement>
) {
  const [dimensions, setDimensions] = useState<DOMRectReadOnly | null>(null);

  useEffect(() => {
    if (ref.current) {
      setDimensions(ref.current.getBoundingClientRect());
    }
  }, [ref]);

  return dimensions;
}
