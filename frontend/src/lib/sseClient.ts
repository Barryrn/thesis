/// Minimal POST-friendly Server-Sent Events client.
///
/// We deliberately use `fetch` + `ReadableStream` instead of the browser's
/// `EventSource`: `EventSource` is GET-only, can't carry a JSON body, can't
/// set custom headers, and doesn't compose with `AbortController`. The
/// section-writer feature needs all four. The wire format is identical to
/// what the Python backend's `/zotero/import` route already produces:
///
///   data: {"type":"...","...":"..."}\n\n
///
/// One frame per logical event, separated by blank lines.

/// Discriminated union the caller pattern-matches on. `type` is whatever
/// string the server emitted; the payload is whatever JSON it sent.
export interface SseEvent {
  type: string;
  [key: string]: unknown;
}

/// Options for {@link streamSSE}.
export interface StreamSSEOptions {
  /// Absolute or relative URL to POST to.
  url: string;
  /// Plain JSON object — will be `JSON.stringify`'d.
  body: unknown;
  /// Caller-owned abort signal. Closing the stream from the consumer side
  /// (e.g. when a popover unmounts) is the most common reason this exists.
  signal: AbortSignal;
  /// Called once for every parsed `data: …\n\n` frame. Throwing here
  /// aborts the stream — the rejection propagates back to the caller.
  onEvent: (event: SseEvent) => void;
}

/// Stream a POST SSE response, dispatching one event per `data:` frame.
///
/// Resolves when the server closes the stream cleanly. Rejects on network
/// failure, non-2xx responses, or if `signal` aborts mid-stream. The
/// returned promise carries no value; consumers should accumulate state
/// inside `onEvent`.
export async function streamSSE({
  url,
  body,
  signal,
  onEvent,
}: StreamSSEOptions): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `SSE request failed: ${response.status} ${response.statusText}` +
        (text ? ` — ${text}` : "")
    );
  }
  if (!response.body) {
    throw new Error("SSE response had no body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  /// Frame buffer — SSE frames are separated by a blank line, but a
  /// single TCP read may deliver a partial frame or several at once.
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Pop every complete frame (terminated by a blank line).
      let frameEnd: number;
      while ((frameEnd = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, frameEnd);
        buffer = buffer.slice(frameEnd + 2);
        const event = parseFrame(frame);
        if (event) onEvent(event);
      }
    }
  } finally {
    // Releasing the reader lets `AbortController.abort()` cancel the
    // underlying connection promptly when the caller bails out early.
    try {
      reader.releaseLock();
    } catch {
      /* already released */
    }
  }
}

/// Parse one SSE frame ("data: …" lines, possibly with comments).
/// Returns null when the frame carries no `data:` line we can decode.
function parseFrame(frame: string): SseEvent | null {
  const lines = frame.split("\n");
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith("data:")) {
      // Strip exactly one leading space if present, per the SSE spec.
      const payload = line.slice(5);
      dataLines.push(payload.startsWith(" ") ? payload.slice(1) : payload);
    }
    // Comments (":" prefix) and other field names (event:, id:, retry:)
    // are ignored — the backend only ever emits `data:` lines.
  }
  if (dataLines.length === 0) return null;
  const json = dataLines.join("\n");
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    if (typeof parsed.type !== "string") return null;
    return parsed as SseEvent;
  } catch {
    return null;
  }
}
