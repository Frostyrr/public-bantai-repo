import { AlertCircle, ArrowLeft, Building2, RefreshCw } from "lucide-react";
import { formatErrorMessage } from "../../utils/formatError";
import Button from "../ui/Button";

export interface WorkspaceAccessStateInput {
  isPending: boolean;
  isError: boolean;
  isFetching?: boolean;
  hasMembership: boolean;
}

export type WorkspaceAccessState = "loading" | "error" | "inaccessible" | "ready";

export function resolveWorkspaceAccessState({
  isPending,
  isError,
  isFetching = false,
  hasMembership,
}: WorkspaceAccessStateInput): WorkspaceAccessState {
  if (hasMembership) {
    return "ready";
  }
  if (isPending || (isError && isFetching)) {
    return "loading";
  }
  if (isError) {
    return "error";
  }
  return "inaccessible";
}

export interface WorkspaceAccessErrorCardProps {
  mode: "error" | "inaccessible";
  error?: unknown;
  onRetry?: () => void;
}

export function WorkspaceAccessErrorCard({
  mode,
  error,
  onRetry,
}: WorkspaceAccessErrorCardProps) {
  const isErrorMode = mode === "error";

  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center p-6 text-primary font-body">
      <div className="max-w-md w-full bg-surface border border-subtle rounded-3xl p-8 text-center space-y-4 shadow-xl">
        <div
          className={`w-12 h-12 rounded-2xl border flex items-center justify-center mx-auto ${
            isErrorMode
              ? "bg-sem-danger-bg border-sem-danger-border text-sem-danger-fg"
              : "bg-sem-warning-bg border-sem-warning-border text-sem-warning-fg"
          }`}
        >
          {isErrorMode ? <AlertCircle className="w-6 h-6" /> : <Building2 className="w-6 h-6" />}
        </div>
        <h2 className="text-xl font-heading font-medium text-primary tracking-tight">
          {isErrorMode ? "Unable to Load Workspace" : "Workspace Not Accessible"}
        </h2>
        <p
          role={isErrorMode ? "alert" : undefined}
          className="text-sm text-secondary font-body"
        >
          {isErrorMode
            ? formatErrorMessage(error)
            : "You are not an active member of this organization or this workspace does not exist."}
        </p>
        <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
          {isErrorMode && onRetry && (
            <Button
              variant="primary"
              onClick={onRetry}
              icon={<RefreshCw className="w-4 h-4" />}
            >
              Try again
            </Button>
          )}
          <Button
            variant={isErrorMode && onRetry ? "outline" : "primary"}
            to="/app"
            icon={<ArrowLeft className="w-4 h-4" />}
          >
            Return to Organizations
          </Button>
        </div>
      </div>
    </div>
  );
}
