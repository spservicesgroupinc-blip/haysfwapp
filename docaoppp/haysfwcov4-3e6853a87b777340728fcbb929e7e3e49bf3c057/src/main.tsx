import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import "./styles.css";

// A deploy replaces every hashed file. If a tab is still running an older
// shell, a lazily imported chunk can 404 — reload once to pick up the current
// build instead of leaving the screen stuck.
window.addEventListener("vite:preloadError", () => {
  const recovery = "hays-preload-recovery";
  try {
    if (sessionStorage.getItem(recovery)) return;
    sessionStorage.setItem(recovery, "1");
  } catch {
    return;
  }
  window.location.reload();
});

registerSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    // Long-lived tabs pick up a new deployment within the hour.
    if (!registration) return;
    window.setInterval(() => void registration.update(), 60 * 60 * 1000);
  },
  onRegisterError(error) {
    console.error("Service worker registration failed.", error);
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

// The app rendered, so the inline boot guard in index.html can arm again.
try {
  sessionStorage.removeItem("hays-boot-recovery");
} catch {
  // Storage is unavailable; nothing to clear.
}
