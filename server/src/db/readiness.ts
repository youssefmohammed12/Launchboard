/**
 * Readiness types are kept separate from the mysql2 pool so the Express app can
 * accept a probe without importing the driver or opening a connection.
 */
export type ReadinessFailureReason =
  | 'not_configured'
  | 'target_mismatch'
  | 'unreachable';

export interface ReadinessResult {
  ready: boolean;
  reason?: ReadinessFailureReason;
}

export interface ReadinessProbe {
  check(): Promise<ReadinessResult>;
}
