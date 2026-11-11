import { useEffect, useState } from "react";
import { Copy } from "lucide-react";
import "./CopyDashNote.css";

export default function CopyDashNote({
  text,
  disabled = false,
}: {
  text: string;
  disabled?: boolean;
}) {
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState(false);
  useEffect(() => {
    setCopied(false);
    setManual(false);
  }, [text]);
  async function copy() {
    setCopying(true);
    setCopied(false);
    setManual(false);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setManual(true);
    } finally {
      setCopying(false);
    }
  }
  return (
    <div className="copy-dash">
      <button
        type="button"
        className="button"
        disabled={disabled || copying}
        onClick={() => void copy()}
      >
        <Copy size={16} />
        Copy Dash note
      </button>
      {copied ? <p role="status">Copied. Paste this note into Dash.</p> : null}
      {manual ? (
        <>
          <p role="alert">
            Clipboard access is unavailable. Select and copy the note below.
          </p>
          <textarea
            aria-label="Dash note to copy manually"
            readOnly
            rows={8}
            value={text}
            onFocus={(event) => event.target.select()}
          />
        </>
      ) : null}
    </div>
  );
}
