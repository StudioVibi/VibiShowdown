const REMOTE_WSS = "wss://game.vibistudiotest.site";

function has_window(): boolean {
  return typeof window !== "undefined" && typeof window.location !== "undefined";
}

function from_global_override(): string | undefined {
  if (!has_window()) return undefined;
  const global_any = window as typeof window & { __VIBI_WS_URL__?: string };
  if (typeof global_any.__VIBI_WS_URL__ === "string") {
    return global_any.__VIBI_WS_URL__;
  }
  return undefined;
}

function normalize(value: string): string {
  if (value.startsWith("wss://") || value.startsWith("ws://")) {
    return value;
  }
  if (value.startsWith("https://")) {
    return `wss://${value.slice("https://".length)}`;
  }
  if (value.startsWith("http://")) {
    return `ws://${value.slice("http://".length)}`;
  }
  const lower = value.toLowerCase();
  const is_local =
    lower.startsWith("localhost") || lower.startsWith("127.0.0.1") || lower.startsWith("0.0.0.0");
  return `${is_local ? "ws" : "wss"}://${value}`;
}

function from_query_param(): string | undefined {
  if (!has_window()) return undefined;
  try {
    const url = new URL(window.location.href);
    const value = url.searchParams.get("ws");
    if (value) {
      return normalize(value);
    }
  } catch {
    // ignore malformed URLs
  }
  return undefined;
}

function detect_url(): string {
  const manual = from_global_override() ?? from_query_param();
  if (manual) {
    return manual;
  }
  return REMOTE_WSS;
}

export const WS_URL = detect_url();
export const DEFAULT_REMOTE_WS = REMOTE_WSS;
