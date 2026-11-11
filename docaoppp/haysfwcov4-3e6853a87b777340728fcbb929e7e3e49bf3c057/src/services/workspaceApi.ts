import { API_URL, ApiError } from "./storage";

/** All workspace actions use CORS-simple POSTs; an HTTP 200 alone is not success. */
export async function workspaceApi<T>(
  action: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    action === "analyzeIntake" ? 90000 : 60000,
  );
  try {
    const response = await fetch(API_URL, {
      method: "POST",
      redirect: "follow",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, ...payload }),
      signal: controller.signal,
    });
    const raw = await response.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new ApiError(
        "The workspace service did not return JSON. Check its Apps Script deployment.",
        "BAD_RESPONSE",
      );
    }
    if (!response.ok || data.ok !== true) {
      const unknown = /unknown action/i.test(data.error || "");
      throw new ApiError(
        unknown
          ? "Jobs & Documents requires the updated Apps Script backend. Your device copy is safe; deploy the new Code.gs and retry."
          : data.error || "The workspace service is unavailable.",
        unknown ? "DEPLOYMENT_REQUIRED" : data.code,
        data.currentRevision,
      );
    }
    return data as T;
  } catch (error) {
    if (controller.signal.aborted)
      throw new ApiError(
        "The workspace service timed out. Your device changes are still saved; retry synchronization.",
        "TIMEOUT",
      );
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
