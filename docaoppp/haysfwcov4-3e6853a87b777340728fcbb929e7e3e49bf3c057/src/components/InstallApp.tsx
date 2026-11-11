import { useEffect, useState } from "react";
import { Download, Share, X } from "lucide-react";
import "./InstallApp.css";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isIOS(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export default function InstallApp() {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIOS, setShowIOS] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;

    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setPrompt(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setPrompt(null);
      setShowIOS(false);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);

    let timer: number | undefined;
    if (isIOS()) {
      timer = window.setTimeout(() => setShowIOS(true), 1500);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  const install = async () => {
    if (!prompt) return;
    await prompt.prompt();
    await prompt.userChoice;
    setPrompt(null);
  };

  if (dismissed || isStandalone()) return null;

  if (prompt) {
    return (
      <div className="install-banner" role="region" aria-label="Install app">
        <div className="install-banner-text">
          <strong>Install Change Orders</strong>
          <span>
            Add it to your home screen for a full-screen, offline-ready app.
          </span>
        </div>
        <div className="install-banner-actions">
          <button
            className="button primary small"
            onClick={() => void install()}
          >
            <Download size={16} />
            Install
          </button>
          <button
            className="icon-button"
            aria-label="Dismiss install prompt"
            onClick={() => setDismissed(true)}
          >
            <X size={16} />
          </button>
        </div>
      </div>
    );
  }

  if (showIOS) {
    return (
      <div
        className="install-banner"
        role="region"
        aria-label="Add to home screen"
      >
        <div className="install-banner-text">
          <strong>Add Change Orders to your home screen</strong>
          <span>Tap the Share button, then choose “Add to Home Screen”.</span>
        </div>
        <div className="install-banner-actions">
          <span className="install-share-hint">
            <Share size={16} />
          </span>
          <button
            className="icon-button"
            aria-label="Dismiss"
            onClick={() => setDismissed(true)}
          >
            <X size={16} />
          </button>
        </div>
      </div>
    );
  }

  return null;
}
