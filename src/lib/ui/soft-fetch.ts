/**
 * Live data hook — PATCH STATE ONLY.
 * Module-level last-good store survives remounts so the shell never empties.
 * No sessionStorage in useState (avoids SSR hydration mismatch).
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

const LAST_GOOD = new Map<string, unknown>();

export type SoftFetchState<T> = {
  data: T | null;
  error: string | null;
  loading: boolean;
  refreshing: boolean;
  lastOkAt: number | null;
  refresh: (opts?: { force?: boolean }) => Promise<void>;
};

function cacheRead<T>(key: string): T | null {
  const mem = LAST_GOOD.get(key);
  if (mem != null) return mem as T;
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { t: number; v: T };
    if (parsed?.v != null) LAST_GOOD.set(key, parsed.v);
    return parsed?.v ?? null;
  } catch {
    return null;
  }
}

function cacheWrite<T>(key: string, v: T) {
  LAST_GOOD.set(key, v);
  if (typeof sessionStorage === "undefined") return;
  try {
    const raw = JSON.stringify({ t: Date.now(), v });
    if (raw.length > 800_000) {
      sessionStorage.removeItem(key);
      return;
    }
    sessionStorage.setItem(key, raw);
  } catch {
    try {
      sessionStorage.removeItem(key);
    } catch {
      /* */
    }
  }
}

/** Sync peek for held-data / first paint without hooks */
export function peekLastGood<T>(key: string): T | null {
  return cacheRead<T>(key);
}

export type SoftFetchOptions<T> = {
  key: string;
  url?: string | (() => string);
  fetcher?: (signal: AbortSignal, force: boolean) => Promise<T>;
  parse?: (json: unknown) => T;
  isValid?: (data: T) => boolean;
  pollMs?: number;
  timeoutMs?: number;
  enabled?: boolean;
  pauseWhenHidden?: boolean;
};

export function useSoftFetch<T>(opts: SoftFetchOptions<T>): SoftFetchState<T> {
  const {
    key,
    url,
    fetcher,
    parse,
    isValid,
    pollMs = 0,
    timeoutMs = 8_000,
    enabled = true,
    pauseWhenHidden = true,
  } = opts;

  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastOkAt, setLastOkAt] = useState<number | null>(null);

  const dataRef = useRef<T | null>(null);
  const mounted = useRef(true);
  const busy = useRef(false);
  const queueForce = useRef(false);

  const fetcherRef = useRef(fetcher);
  const urlRef = useRef(url);
  const parseRef = useRef(parse);
  const isValidRef = useRef(isValid);
  fetcherRef.current = fetcher;
  urlRef.current = url;
  parseRef.current = parse;
  isValidRef.current = isValid;

  const apply = useCallback(
    (next: T) => {
      dataRef.current = next;
      setData(next);
      cacheWrite(key, next);
      setError(null);
      setLastOkAt(Date.now());
      setLoading(false);
    },
    [key],
  );

  const run = useCallback(
    async (force: boolean, isUser: boolean) => {
      if (!enabled || !mounted.current) return;

      if (busy.current) {
        if (force || isUser) queueForce.current = true;
        return;
      }

      busy.current = true;
      if (isUser) setRefreshing(true);
      if (!dataRef.current) setLoading(true);

      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), timeoutMs);

      try {
        let next: T;
        const f = fetcherRef.current;
        if (f) {
          next = await f(ac.signal, force || queueForce.current);
        } else {
          const u =
            typeof urlRef.current === "function"
              ? urlRef.current()
              : urlRef.current;
          if (!u) throw new Error("missing url");
          const res = await fetch(u, {
            cache: "no-store",
            signal: ac.signal,
            headers: { accept: "application/json" },
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json: unknown = await res.json();
          next = parseRef.current ? parseRef.current(json) : (json as T);
        }

        if (!mounted.current) {
          cacheWrite(key, next);
          return;
        }
        if (isValidRef.current && !isValidRef.current(next)) {
          throw new Error("Invalid payload");
        }
        apply(next);
      } catch (e) {
        if (!mounted.current) return;
        const msg =
          e instanceof Error
            ? e.name === "AbortError"
              ? `Timed out after ${timeoutMs}ms`
              : e.message
            : String(e);
        const fallback = dataRef.current ?? cacheRead<T>(key);
        if (fallback) {
          if (!dataRef.current) apply(fallback);
          if (isUser) {
            setError(`Update failed (${msg}). Showing current numbers.`);
          }
        } else {
          setError(msg);
          setLoading(false);
        }
      } finally {
        clearTimeout(timer);
        busy.current = false;
        if (mounted.current) setRefreshing(false);
        if (queueForce.current) {
          queueForce.current = false;
          setTimeout(() => {
            if (mounted.current) void run(false, false);
          }, 120);
        }
      }
    },
    [apply, enabled, key, timeoutMs],
  );

  const refresh = useCallback(async () => {
    await run(false, true);
  }, [run]);

  useLayoutEffect(() => {
    const c = cacheRead<T>(key);
    if (c) {
      dataRef.current = c;
      setData(c);
      setLoading(false);
      setLastOkAt(Date.now());
    }
  }, [key]);

  useEffect(() => {
    mounted.current = true;
    if (!enabled) {
      setLoading(false);
      return;
    }

    void run(false, false);

    let poll: ReturnType<typeof setInterval> | undefined;
    if (pollMs > 0) {
      poll = setInterval(() => {
        if (
          pauseWhenHidden &&
          typeof document !== "undefined" &&
          document.visibilityState === "hidden"
        ) {
          return;
        }
        void run(false, false);
      }, pollMs);
    }

    const onVis = () => {
      if (document.visibilityState === "visible") void run(false, false);
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVis);
    }

    return () => {
      mounted.current = false;
      if (poll) clearInterval(poll);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVis);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key, pollMs, pauseWhenHidden]);

  return { data, error, loading, refreshing, lastOkAt, refresh };
}
