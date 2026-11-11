import { Component, type ErrorInfo, type ReactNode } from "react";
import { FolderOpen, RotateCcw, TriangleAlert } from "lucide-react";
import { clearStoredView } from "../services/navigation";
import "./ErrorBoundary.css";

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/**
 * Last line of defence. A render error used to leave the installed app on a
 * blank screen with no header, no back button and no way out but force-quitting
 * it; this keeps a way home on screen instead.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      "The change order screen failed to render.",
      error,
      info.componentStack,
    );
  }

  private goHome = () => {
    // Both the URL and the remembered view point back at the screen that just
    // failed, so clear them before reloading into a known-good state.
    clearStoredView();
    window.location.hash = "#/";
    window.location.reload();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="fatal">
        <div className="fatal-card" role="alert">
          <div className="empty-icon">
            <TriangleAlert size={28} />
          </div>
          <h1>This screen could not be shown.</h1>
          <p>
            The app hit an unexpected problem. Nothing you saved has been lost.
          </p>
          <code>{error.message || String(error)}</code>
          <div className="button-row">
            <button className="button primary" onClick={this.goHome}>
              <FolderOpen size={16} />
              Back to requests
            </button>
            <button className="button" onClick={() => window.location.reload()}>
              <RotateCcw size={16} />
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
