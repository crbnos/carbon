import { useEffect, useState } from "react";

export function useScrollSpy(ids: string[], offset = 150) {
  const [activeIndex, setActiveIndex] = useState(0);
  useEffect(() => {
    const onScroll = () => {
      let idx = 0;
      ids.forEach((id, i) => {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top < offset) idx = i;
      });
      setActiveIndex(idx);
    };
    onScroll();
    document.addEventListener("scroll", onScroll, { passive: true });
    return () => document.removeEventListener("scroll", onScroll);
  }, [ids, offset]);
  return activeIndex;
}
