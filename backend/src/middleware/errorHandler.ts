import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import AppError, { SessionTimedOutError } from "../utils/AppError";

const errorHandler: ErrorRequestHandler = (error: unknown, req, res, _next) => {
  if (error instanceof ZodError) {
    res.status(400).json({ message: "Invalid request.", errors: error.issues.map(issue => ({ path: issue.path.join("."), message: issue.message })) });
    return;
  }
  if (error instanceof SessionTimedOutError) {
    res.locals.sessionExpiredOrRevoked = true;
    res.status(401).json({ code: error.errorCode, message: error.message });
    return;
  }
  if (error instanceof AppError) {
    res.status(error.statusCode).json({ message: error.message, errorCode: error.errorCode,
      ...("publicCode" in error&&typeof error.publicCode==="string"?{code:error.publicCode}:{}) });
    return;
  }
  if (typeof error === "object" && error !== null && "type" in error) {
    const bodyError = error as { type?: string };
    if (bodyError.type === "entity.too.large") {
      res.status(413).json({ message: "Request payload is too large." });
      return;
    }
    if (bodyError.type === "entity.parse.failed") {
      res.status(400).json({ message: "Malformed JSON request body." });
      return;
    }
  }
  // Do not log request headers, tokens, query strings, or provider responses.
  console.error(
    "Unhandled API error",
    JSON.stringify({
      method: req.method,
      path: req.path,
      name: error instanceof Error ? error.name : "UnknownError",
      message: error instanceof Error ? error.message : String(error),
    }),
  );
  res.status(500).json({ message: "An unexpected error occurred." });
};
export default errorHandler;
