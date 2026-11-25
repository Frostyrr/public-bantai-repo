export function formatErrorMessage(error: unknown): string {
  if (!error) return "";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  return "An error occurred. Please try again.";
}
export default formatErrorMessage;
