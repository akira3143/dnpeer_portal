import { Component, type ReactNode, type ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary] Uncaught error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-950 text-white p-8">
          <div className="max-w-lg text-center space-y-4">
            <div className="text-5xl">⚠️</div>
            <h1 className="text-2xl font-bold text-red-400">Application Render Error</h1>
            <p className="text-gray-400">
              An unexpected error occurred. Please try to recover or reload the page. If the issue persists, contact the network administrator.
            </p>
            <pre className="text-xs text-left bg-gray-900 p-4 rounded-lg overflow-auto max-h-40 text-red-300">
              {this.state.error?.message || 'Unknown error'}
            </pre>
            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                onClick={() => this.setState({ hasError: false, error: null })}
                className="px-5 py-2 bg-white/10 hover:bg-white/15 border border-white/15 text-slate-200 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
              >
                Try Again
              </button>
              <button
                onClick={() => window.location.reload()}
                className="btn-primary px-6 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer shadow-lg"
              >
                Reload Page
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
