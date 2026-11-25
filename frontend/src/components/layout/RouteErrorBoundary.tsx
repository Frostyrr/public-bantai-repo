import { Component, type ErrorInfo, type ReactNode } from "react";

export default class RouteErrorBoundary extends Component<
  { children: ReactNode; resetKey: string; embedded?: boolean },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(prevProps: { resetKey: string }) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Route render error:", error, info);
  }

  render() {
    if (this.state.error) {
      const moduleLoadFailed = /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|loading chunk .* failed/i.test(this.state.error.message);
      const height = this.props.embedded ? "min-h-64" : "min-h-screen";
      return (
        <section className={height + " flex flex-col items-center justify-center gap-4 p-6 text-center text-primary"}>
          <h1 className="text-lg font-semibold">{moduleLoadFailed ? "This page couldn’t load" : "Something went wrong"}</h1>
          <p className="max-w-md text-sm text-secondary break-words">
            {moduleLoadFailed
              ? "Reload to get the latest version. If it still fails, check your connection and try again."
              : this.state.error.message || "An unexpected error occurred while rendering this page."}
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-lg border border-subtle bg-surface px-4 py-2 text-xs font-medium text-primary hover:bg-elevated cursor-pointer"
            >
              Reload page
            </button>
            <button
              type="button"
              onClick={() => window.history.back()}
              className="rounded-lg border border-subtle px-4 py-2 text-xs font-medium text-secondary hover:text-primary cursor-pointer"
            >
              Go back
            </button>
          </div>
        </section>
      );
    }
    return this.props.children;
  }
}
