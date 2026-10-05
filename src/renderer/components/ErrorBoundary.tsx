import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | undefined;
}

/**
 * Keeps a renderer crash visible. Without this, a failing effect unmounts the
 * whole tree and the window shows nothing but the background colour.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: undefined };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Renderer crashed:', error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="crash-screen" role="alert">
        <h1>Zap hit an unexpected error</h1>
        <p className="crash-message">{error.message}</p>
        <pre className="crash-stack">{error.stack ?? 'No stack trace available.'}</pre>
        <button type="button" onClick={() => window.location.reload()}>
          Reload the window
        </button>
      </div>
    );
  }
}
