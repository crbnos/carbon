import { useEffect, useRef } from "react";

export function useSubmitComplete(isSubmitting: boolean, callback: () => void) {
  const isPending = useRef(false);
  useEffect(() => {
    if (isSubmitting) {
      isPending.current = true;
    }

    if (!isSubmitting && isPending.current) {
      isPending.current = false;
      callback();
    }
  });
}
