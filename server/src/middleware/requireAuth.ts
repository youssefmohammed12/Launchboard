import type { RequestHandler } from "express";
import { parseCookies } from "../auth/cookies.js";
import { SESSION_COOKIE_NAME } from "../auth/cookies.js";

import { findActiveAuthSession, touchAuthSession } from "../auth/sessionRepo.js";
import { isValidToken } from "../auth/tokens.js";
import { ApiError } from "../errors.js";
import type { Pool } from "mysql2/promise";

export interface AuthenticatedRequest extends Express.Request {
  auth?: {
    sessionId: string;
    userId: string;
    user: { id: string; email: string };
  };
}

export function createRequireAuth(pool: Pool): RequestHandler {
  return async (req, _res, next) => {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[SESSION_COOKIE_NAME];
    if (!token || typeof token !== "string" || !isValidToken(token)) {
      return next(new ApiError(401, "UNAUTHORIZED", "Authentication required."));
    }

    let session;
    try {
      session = await findActiveAuthSession(pool, token);
    } catch {
      return next(new ApiError(503, "NOT_READY", "Service unavailable."));
    }
    if (!session) {
      return next(new ApiError(401, "UNAUTHORIZED", "Authentication required."));
    }

    // Safe methods are strictly read-only. Authenticated GET/HEAD/OPTIONS
    // requests must not extend idle expiry or otherwise write session state.
    if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS") {
      try {
        const touched = await touchAuthSession(pool, session.session.id);
        if (!touched) {
          return next(new ApiError(401, "UNAUTHORIZED", "Authentication required."));
        }
      } catch {
        return next(new ApiError(503, "NOT_READY", "Service unavailable."));
      }
    }

    (req as AuthenticatedRequest).auth = {
      sessionId: session.session.id,
      userId: session.user.id,
      user: session.user,
    };
    next();
  };
}
