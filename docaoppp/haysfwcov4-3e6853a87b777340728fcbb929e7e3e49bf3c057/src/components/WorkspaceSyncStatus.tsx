import { useEffect, useState } from "react";
import {
  cachedWorkspaces,
  startWorkspaceSync,
  subscribeWorkspaces,
  syncWorkspaces,
} from "../services/workspaces";
import { readDocumentRows } from "../workspaces/localStore";

/** Shell-owned sync continues after leaving the document workspace. */
export default function WorkspaceSyncStatus() {
  const [state, setState] = useState({ pending: 0, error: "" });
  const [retrying, setRetrying] = useState(false);
  useEffect(() => {
    let active = true;
    const read = async () => {
      const [rows, documents] = await Promise.all([
        cachedWorkspaces(),
        readDocumentRows(),
      ]);
      const pendingRows = rows.filter(
        (row) => row.dirty || row.inFlight || row.conflict,
      );
      const pendingDocuments = documents.filter((row) => row.pending);
      if (active)
        setState({
          pending: pendingRows.length + pendingDocuments.length,
          error:
            pendingRows.find((row) => row.error)?.error ||
            pendingDocuments.find((row) => row.error)?.error ||
            "",
        });
    };
    void read().catch(() => undefined);
    const unsubscribe = subscribeWorkspaces(
      () => void read().catch(() => undefined),
    );
    const stop = startWorkspaceSync();
    return () => {
      active = false;
      unsubscribe();
      stop();
    };
  }, []);
  if (!state.pending) return null;
  return (
    <div className="workspace-sync-global" role="status">
      <span>
        {state.pending} job/document {state.pending === 1 ? "save" : "saves"}{" "}
        waiting to sync.{state.error ? ` ${state.error}` : ""}
      </span>
      <button
        className="button small"
        disabled={retrying}
        onClick={() => {
          setRetrying(true);
          void syncWorkspaces()
            .catch(() => undefined)
            .finally(() => setRetrying(false));
        }}
      >
        Retry sync
      </button>
    </div>
  );
}
