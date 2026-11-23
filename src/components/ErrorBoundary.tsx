import { Component, type ReactNode } from "react";

/**
 * Catches render errors so a crash shows a message instead of a blank window.
 * Give it a `key` that changes on navigation so moving to another page resets it.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode; onReset?: () => void },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error(error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const details = `${error.name}: ${error.message}${error.stack ? `\n\n${error.stack}` : ""}`;
    return (
      <div className="page">
        <div className="empty empty--error">
          <h3>Something went wrong on this page</h3>
          <p>Please report this on GitHub and include the details below.</p>
          <pre className="error-details">{details}</pre>
          <div className="error-actions">
            <button className="btn btn--ghost" onClick={() => navigator.clipboard?.writeText(details)}>
              Copy details
            </button>
            <button
              className="btn btn--ghost"
              onClick={() => {
                this.setState({ error: null });
                this.props.onReset?.();
              }}
            >
              Back to Discover
            </button>
          </div>
        </div>
      </div>
    );
  }
}
