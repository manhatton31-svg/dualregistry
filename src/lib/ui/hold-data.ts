import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { peekLastGood } from "@/lib/ui/soft-fetch";

/**
 * Hold the last non-null payload so UI never empties.
 * First client render matches SSR (null). Cache hydrate only in layout effect.
 */
export function useHeldData<T>(data: T | null, cacheKey?: string): T | null {
  const [held, setHeld] = useState<T | null>(null);
  const ref = useRef<T | null>(null);

  // After hydration only — restore memory/session so we don't flash empty
  useLayoutEffect(() => {
    if (data != null) {
      ref.current = data;
      setHeld(data);
      return;
    }
    if (cacheKey) {
      const p = peekLastGood<T>(cacheKey);
      if (p != null) {
        ref.current = p;
        setHeld(p);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey]);

  useEffect(() => {
    if (data != null) {
      ref.current = data;
      setHeld(data);
    }
  }, [data]);

  return data ?? held ?? ref.current;
}
