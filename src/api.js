export const isTauri = Boolean(window.__TAURI_INTERNALS__);
export let tauriInvoke = null;

export class ApiError extends Error {
  constructor(code, message, currentRevision) {
    super(message);
    this.code = code;
    this.currentRevision = currentRevision;
  }
}

export function normalizeError(error) {
  if (error instanceof ApiError) return error;
  const msg = typeof error === "string" ? error : (error?.message || String(error));
  const conflictMatch = msg.match(/^CONFLICT:(.+)/);
  if (conflictMatch) return new ApiError("CONFLICT", "Revision conflict", conflictMatch[1]);
  if (msg.startsWith("NOT_FOUND:")) return new ApiError("NOT_FOUND", "Item not found");
  if (msg.startsWith("VALIDATION:")) return new ApiError("VALIDATION", msg.replace(/^VALIDATION:\s*/, ""));
  if (msg.startsWith("IO:")) return new ApiError("IO", msg.replace(/^IO:\s*/, ""));
  return new ApiError("IO", msg);
}

export async function invoke(command, payload = {}) {
  if (isTauri) {
    if (!tauriInvoke) {
      tauriInvoke = (await import("@tauri-apps/api/core")).invoke;
    }
    try {
      return await tauriInvoke(command, payload);
    } catch (error) {
      throw normalizeError(error);
    }
  }

  const response = await fetch(`/api/${command}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let body;
    try { body = await response.json(); } catch { throw new ApiError("IO", "Request failed"); }
    throw new ApiError(body.code || "IO", body.message || "Request failed", body.currentRevision);
  }

  return response.status === 204 ? null : response.json();
}
