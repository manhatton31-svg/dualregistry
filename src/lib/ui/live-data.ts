/**
 * Tiny live-data helper: patch state only, never blank the page.
 * Module memory keeps last payload across remounts (HMR / StrictMode).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

const MEM = new Map<string, unknown>();

export function useLiveData<T>(opts: {
  key: string;
  url?: string;
  /** Custom loader (dashboard server client, etc.) */
  loader?: () => Promise<T>;
  parse?: (json: unknown) => T;
  isValid?: (data: T) => boolean;
  pollMs?: number;
  enabled?: boolean;
}) {
  const {
    key,
    url,
    loader,
    parse,
    isValid,
    pollMs = 0,
    enabled = true,
  } = opts;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const busy = useRef(false);
  const mounted = useRef(true);
  const loaderRef = useRef(loader);
  const parseRef = useRef(parse);
  const isValidRef = useRef(isValid);
  loaderRef.current = loader;
  parseRef.current = parse;
  isValidRef.current = isValid;

  // Restore memory before paint so remounts don't flash empty
  useLayoutEffect(() => {
    mounted.current = true;
    const mem = MEM.get(key) as T | undefined;
    if (mem != null) {
      setData(mem);
      setLoading(false);
    }
    return () => {
      mounted.current = false;
    };
  }, [key]);

  const load = useCallback(
    async (user = false) => {
      if (!enabled || busy.current) return;
      busy.current = true;
      if (user) setRefreshing(true);
      try {
        let next: T;
        if (loaderRef.current) {
          next = await loaderRef.current();
        } else if (url) {
          const res = await fetch(url, {
            cache: "no-store",
            headers: { accept: "application/json" },
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json: unknown = await res.json();
          next = parseRef.current ? parseRef.current(json) : (json as T);
        } else {
          throw new Error("live-data: need url or loader");
        }
        if (isValidRef.current && !isValidRef.current(next)) {
          throw new Error("Invalid payload");
        }
        MEM.set(key, next);
        if (!mounted.current) return;
        setData(next);
        setError(null);
      } catch (e) {
        if (!mounted.current) return;
        const msg = e instanceof Error ? e.message : String(e);
        if (MEM.has(key)) {
          setData(MEM.get(key) as T);
          if (user) setError(`Update failed (${msg}). Showing current data.`);
        } else {
          setError(msg);
        }
      } finally {
        busy.current = false;
        if (mounted.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [enabled, key, url],
  );

  useEffect(() => {
    if (!enabled) return;
    void load(false);
    if (pollMs <= 0) return;
    const t = setInterval(() => {
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "hidden"
      )
        return;
      void load(false);
    }, pollMs);
    return () => clearInterval(t);
    // Intentionally mount-once + poll; load reads latest refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key, pollMs, url]);

  return {
    data,
    error,
    loading: loading && data == null,
    refreshing,
    refresh: () => load(true),
    lastOkAt: data ? Date.now() : null,
  };
}
