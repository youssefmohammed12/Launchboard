export {};

declare global {
  namespace Express {
    interface Request {
      /** Assigned by the request-id middleware before any route runs. */
      requestId: string;
      /** Set by validateBody after a schema accepts the request body. */
      validatedBody?: unknown;
    }
  }
}
