import { Component, type ReactNode } from 'react';
import { Button } from './ui';

interface Props {
  children: ReactNode;
  onReset: () => void;
}

/** Shows a friendly message instead of a blank page if something unexpected breaks. */
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mx-auto max-w-lg rounded-xl border border-rose-200 bg-surface p-6 text-center shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900">Something went wrong</h1>
        <p className="mt-2 text-sm text-slate-600">
          We couldn’t finish building the plan from this file. Your data hasn’t left your browser. Try another file, or
          check the columns on the “Check your data” step.
        </p>
        <Button
          className="mt-4"
          onClick={() => {
            this.setState({ error: null });
            this.props.onReset();
          }}
        >
          Start over
        </Button>
      </div>
    );
  }
}
