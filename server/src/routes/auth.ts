import { randomUUID } from "node:crypto";
import { Router } from "express";
import type { Pool } from "mysql2/promise";
import type { RequestHandler } from "express";
import { ApiError } from "../errors.js";
import { isExactOriginAllowed } from "../auth/origin.js";
import { parseAuthEnv, parseEmailEnv } from "../config/env.js";
import type { EmailServiceConfig } from "../config/env.js";
import { createAccountActionToken } from "../auth/accountActionRepo.js";
import { sendEmail, type EmailMessage } from "../services/emailService.js";
import { createAuthRateLimiters } from "../middleware/authRateLimiters.js";
import {
  consumePreAuthSession,
  createAuthSession,
  createPreAuthSession,
  findPreAuthSession,
  revokePreAuthSession,
  findActiveAuthSession,
  revokeAuthSession,
} from "../auth/sessionRepo.js";
import { deriveCsrfToken, verifyCsrfToken } from "../auth/csrf.js";
import {
  hashPassword,
  verifyPassword,
  isCurrentArgon2Params,
} from "../auth/password.js";
import { isValidToken } from "../auth/tokens.js";
import {
  PRE_SESSION_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  preSessionCookieOptions,
  sessionCookieOptions,
  clearSessionCookieOptions,
  clearPreSessionCookieOptions,
  serializeCookie,
  parseCookies,
} from "../auth/cookies.js";
import { loginSchema, registerSchema } from "../validation/authSchemas.js";
import { acquireUtcConnection } from "../db/pool.js";

const DUMMY_LOGIN_PASSWORD = "launchboard:dummy-login-timing-check:v1";

interface UserCredentialRow {
  id: string;
  email: string;
  password_hash: string;
  email_verified_at: string | Date | null;
}

function isDuplicateEmailError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const databaseError = error as { code?: unknown; sqlMessage?: unknown };
  if (databaseError.code !== "ER_DUP_ENTRY") return false;
  return (
    typeof databaseError.sqlMessage === "string" &&
    /uq_users_email|users\.email/i.test(databaseError.sqlMessage)
  );
}

export type AuthEmailSender = (
  config: EmailServiceConfig,
  message: EmailMessage,
) => Promise<void>;

export function createAuthRouter(
  pool: Pool | null,
  options: { emailSender?: AuthEmailSender } = {},
): Router {
  const router = Router();
  const emailSender = options.emailSender ?? sendEmail;
  const rateLimiters = createAuthRateLimiters();
  const noStore: RequestHandler = (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  };

  router.post("/auth/register", noStore, rateLimiters.registrationByIp, (async (req, res, next) => {

    if (!pool) {
      return next(new ApiError(503, "NOT_READY", "Service unavailable."));
    }

    let authEnv;
    try {
      authEnv = parseAuthEnv(process.env);
    } catch {
      return next(new ApiError(500, "INTERNAL_ERROR", "Authentication is not configured."));
    }
    if (!authEnv) {
      return next(new ApiError(500, "INTERNAL_ERROR", "Authentication is not configured."));
    }

    let emailConfig;
    try {
      emailConfig = parseEmailEnv(process.env);
    } catch {
      return next(new ApiError(503, "NOT_READY", "Email delivery is not configured."));
    }
    if (!emailConfig) {
      return next(new ApiError(503, "NOT_READY", "Email delivery is not configured."));
    }

    const origin = req.headers.origin as string | undefined;
    if (!isExactOriginAllowed(origin, authEnv.trustedOrigins)) {
      return next(new ApiError(403, "FORBIDDEN", "Origin not allowed."));
    }

    if (!req.is("application/json")) {
      return next(new ApiError(400, "INVALID_REQUEST", "Content-Type must be application/json."));
    }

    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      const fields = Object.fromEntries(
        parsed.error.issues.map((issue) => [issue.path.join("."), issue.message]),
      );
      return next(
        new ApiError(422, "VALIDATION_ERROR", "Registration details are invalid.", {
          fields,
        }),
      );
    }

    const cookies = parseCookies(req.headers.cookie);
    const preSessionToken = cookies[PRE_SESSION_COOKIE_NAME];
    if (
      typeof preSessionToken !== "string" ||
      !isValidToken(preSessionToken)
    ) {
      return next(new ApiError(403, "FORBIDDEN", "A valid pre-authentication session is required."));
    }

    let preSession;
    try {
      preSession = await findPreAuthSession(pool, preSessionToken);
    } catch {
      return next(new ApiError(503, "NOT_READY", "Service unavailable."));
    }
    if (!preSession) {
      return next(new ApiError(403, "FORBIDDEN", "A valid pre-authentication session is required."));
    }

    const submittedCsrf = req.get("X-CSRF-Token");
    if (
      typeof submittedCsrf !== "string" ||
      !verifyCsrfToken(authEnv.csrfSecret, "pre-auth", preSessionToken, submittedCsrf)
    ) {
      return next(new ApiError(403, "FORBIDDEN", "CSRF validation failed."));
    }

    let passwordHash: string;
    try {
      passwordHash = await hashPassword(parsed.data.password);
    } catch {
      return next(new ApiError(503, "NOT_READY", "Service unavailable."));
    }

    const userId = randomUUID();
    let connection: Awaited<ReturnType<typeof acquireUtcConnection>> | null = null;
    let transactionStarted = false;

    try {
      connection = await acquireUtcConnection(pool);
      await connection.beginTransaction();
      transactionStarted = true;

      const consumed = await consumePreAuthSession(connection, preSession.id);
      if (!consumed) {
        await connection.rollback();
        transactionStarted = false;
        return next(new ApiError(403, "FORBIDDEN", "Pre-authentication session is no longer valid."));
      }

      await connection.execute(
        `INSERT INTO users (
           id, email, password_hash, email_verified_at,
           opportunity_revision, created_at, updated_at
         ) VALUES (?, ?, ?, NULL, 0, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [userId, parsed.data.email, passwordHash],
      );

      const verification = await createAccountActionToken(
        connection,
        userId,
        "verify_email",
        24 * 60,
      );
      await connection.commit();
      transactionStarted = false;

      const verificationUrl = new URL("/", emailConfig.appBaseUrl);
      // Keep the one-time token in the fragment, which browsers do not send
      // with the initial HTTP request to Vercel.
      verificationUrl.hash = new URLSearchParams([
        ["verifyEmail", verification.token],
      ]).toString();
      try {
        await emailSender(emailConfig, {
          to: parsed.data.email,
          subject: "Verify your Launchboard email",
          text: [
            "Verify your email address to activate your Launchboard account.",
            "",
            verificationUrl.toString(),
            "",
            "This link expires in 24 hours and can only be used once.",
            "If you did not request this account, you can ignore this email.",
          ].join("\n"),
        });
      } catch {
        // Keep registration's public response generic. The user can request a
        // fresh verification link through the resend endpoint.
      }

      const clearPreCookie = serializeCookie(
        PRE_SESSION_COOKIE_NAME,
        "",
        { ...clearPreSessionCookieOptions(), maxAge: 0 },
      );
      res.setHeader("Set-Cookie", clearPreCookie);
      return res.status(202).json({
        message: "If an account is eligible, verification instructions will be sent to its email address.",
      });
    } catch (error) {
      if (transactionStarted && connection) {
        try {
          await connection.rollback();
        } catch {
          // Preserve the original failure; rollback errors are never exposed.
        }
      }

      if (isDuplicateEmailError(error)) {
        // Registration did not consume the pre-auth row because the transaction
        // rolled back. Clear the browser cookie so it cannot be reused.
        const clearPreCookie = serializeCookie(
          PRE_SESSION_COOKIE_NAME,
          "",
          { ...clearPreSessionCookieOptions(), maxAge: 0 },
        );
        res.setHeader("Set-Cookie", clearPreCookie);
        return res.status(202).json({
          message: "If an account is eligible, verification instructions will be sent to its email address.",
        });
      }
      return next(new ApiError(503, "NOT_READY", "Service unavailable."));
    } finally {
      connection?.release();
    }
  }) as RequestHandler);

  router.post("/auth/login", noStore, rateLimiters.loginByIp, rateLimiters.loginByAccount, (async (req, res, next) => {
    if (!pool) {
      return next(new ApiError(503, "NOT_READY", "Service unavailable."));
    }

    let authEnv;
    try {
      authEnv = parseAuthEnv(process.env);
    } catch {
      return next(new ApiError(500, "INTERNAL_ERROR", "Authentication is not configured."));
    }
    if (!authEnv) {
      return next(new ApiError(500, "INTERNAL_ERROR", "Authentication is not configured."));
    }

    const origin = req.headers.origin as string | undefined;
    if (!isExactOriginAllowed(origin, authEnv.trustedOrigins)) {
      return next(new ApiError(403, "FORBIDDEN", "Origin not allowed."));
    }

    if (!req.is("application/json")) {
      return next(new ApiError(400, "INVALID_REQUEST", "Content-Type must be application/json."));
    }

    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      const fields = Object.fromEntries(
        parsed.error.issues.map((issue) => [issue.path.join("."), issue.message]),
      );
      return next(
        new ApiError(422, "VALIDATION_ERROR", "Login details are invalid.", {
          fields,
        }),
      );
    }

    const cookies = parseCookies(req.headers.cookie);
    const preSessionToken = cookies[PRE_SESSION_COOKIE_NAME];
    if (
      typeof preSessionToken !== "string" ||
      !isValidToken(preSessionToken)
    ) {
      return next(new ApiError(403, "FORBIDDEN", "A valid pre-authentication session is required."));
    }

    let preSession;
    try {
      preSession = await findPreAuthSession(pool, preSessionToken);
    } catch {
      return next(new ApiError(503, "NOT_READY", "Service unavailable."));
    }
    if (!preSession) {
      return next(new ApiError(403, "FORBIDDEN", "A valid pre-authentication session is required."));
    }

    const submittedCsrf = req.get("X-CSRF-Token");
    if (
      typeof submittedCsrf !== "string" ||
      !verifyCsrfToken(authEnv.csrfSecret, "pre-auth", preSessionToken, submittedCsrf)
    ) {
      return next(new ApiError(403, "FORBIDDEN", "CSRF validation failed."));
    }

    let lookupConnection: Awaited<ReturnType<typeof acquireUtcConnection>> | null = null;
    let user: UserCredentialRow | null = null;
    try {
      lookupConnection = await acquireUtcConnection(pool);
      const [rows] = await lookupConnection.execute(
        `SELECT id, email, password_hash, email_verified_at
         FROM users
         WHERE email = ?
         LIMIT 1`,
        [parsed.data.email],
      ) as unknown as [UserCredentialRow[], unknown];
      user = rows[0] ?? null;
    } catch {
      return next(new ApiError(503, "NOT_READY", "Service unavailable."));
    } finally {
      lookupConnection?.release();
    }

    let credentialsValid = false;
    try {
      if (user && isCurrentArgon2Params(user.password_hash)) {
        credentialsValid = await verifyPassword(parsed.data.password, user.password_hash);
      } else {
        // Perform one Argon2 operation for unknown accounts or unsupported
        // stored hashes so the response path is not an immediate account
        // existence oracle. The candidate password is never stored.
        await hashPassword(DUMMY_LOGIN_PASSWORD);
      }
    } catch {
      return next(new ApiError(503, "NOT_READY", "Service unavailable."));
    }

    if (!user || !credentialsValid || user.email_verified_at === null) {
      return next(new ApiError(401, "INVALID_CREDENTIALS", "Email or password is incorrect."));
    }

    let connection: Awaited<ReturnType<typeof acquireUtcConnection>> | null = null;
    let transactionStarted = false;

    try {
      connection = await acquireUtcConnection(pool);
      await connection.beginTransaction();
      transactionStarted = true;

      const consumed = await consumePreAuthSession(connection, preSession.id);
      if (!consumed) {
        await connection.rollback();
        transactionStarted = false;
        return next(new ApiError(403, "FORBIDDEN", "Pre-authentication session is no longer valid."));
      }

      const authSession = await createAuthSession(connection, user.id);
      await connection.commit();
      transactionStarted = false;

      const csrfToken = deriveCsrfToken(authEnv.csrfSecret, "authenticated", authSession.token);
      const authCookie = serializeCookie(
        SESSION_COOKIE_NAME,
        authSession.token,
        sessionCookieOptions(),
      );
      const clearPreCookie = serializeCookie(
        PRE_SESSION_COOKIE_NAME,
        "",
        { ...clearPreSessionCookieOptions(), maxAge: 0 },
      );

      res.setHeader("Set-Cookie", [authCookie, clearPreCookie]);
      return res.status(200).json({
        user: { id: user.id, email: user.email },
        csrfToken,
      });
    } catch {
      if (transactionStarted && connection) {
        try {
          await connection.rollback();
        } catch {
          // Preserve the original failure; rollback errors are never exposed.
        }
      }
      return next(new ApiError(503, "NOT_READY", "Service unavailable."));
    } finally {
      connection?.release();
    }
  }) as RequestHandler);

  router.post("/auth/pre-session", noStore, rateLimiters.preSessionByIp, (async (req, res, next) => {
    try {

      if (!pool) {
        return next(new ApiError(503, "NOT_READY", "Service unavailable."));
      }

      const origin = req.headers.origin as string | undefined;
      const authEnv = parseAuthEnv(process.env);
      if (!authEnv) {
        return next(new ApiError(500, "INTERNAL_ERROR", "Authentication is not configured."));
      }

      if (!isExactOriginAllowed(origin, authEnv.trustedOrigins)) {
        return next(new ApiError(403, "FORBIDDEN", "Origin not allowed."));
      }

      const contentType = String(req.headers["content-type"] || "");
      if (!contentType.toLowerCase().includes("application/json")) {
        return next(new ApiError(400, "INVALID_REQUEST", "Content-Type must be application/json."));
      }

      if (req.is && !req.is("application/json")) {
        return next(new ApiError(400, "INVALID_REQUEST", "Content-Type must be application/json."));
      }

      if (!req.body || typeof req.body !== "object" || Array.isArray(req.body) || Object.keys(req.body).length !== 0) {
        return next(new ApiError(400, "VALIDATION_ERROR", "Request body must be an empty object."));
      }

      const cookies = parseCookies(req.headers.cookie);
      try {
        const existingPre = cookies[PRE_SESSION_COOKIE_NAME];
        if (existingPre && typeof existingPre === "string" && isValidToken(existingPre)) {
          const found = await findPreAuthSession(pool, existingPre);
          if (found) {
            await revokePreAuthSession(pool, found.id);
          }
        }

        const created = await createPreAuthSession(pool);
        const csrfToken = deriveCsrfToken(authEnv.csrfSecret, "pre-auth", created.token);
        const cookie = serializeCookie(PRE_SESSION_COOKIE_NAME, created.token, preSessionCookieOptions());
        res.setHeader("Set-Cookie", cookie);
        res.status(200).json({ csrfToken, context: "pre-auth" });
      } catch {
        return next(new ApiError(503, "NOT_READY", "Service unavailable."));
      }
    } catch (err: any) {
      if (err?.code === "FORBIDDEN" || err?.message?.includes("origin")) {
        return next(new ApiError(403, "FORBIDDEN", "Origin not allowed."));
      }
      next(err);
    }
  }) as RequestHandler);

  router.get("/auth/csrf", (async (req, res, next) => {
    try {
      res.setHeader("Cache-Control", "no-store");

      if (!pool) {
        return next(new ApiError(503, "NOT_READY", "Service unavailable."));
      }

      const authEnv = parseAuthEnv(process.env);
      if (!authEnv) {
        return next(new ApiError(401, "UNAUTHORIZED", "Not authenticated."));
      }

      const cookies = parseCookies(req.headers.cookie);
      const sessionToken = cookies[SESSION_COOKIE_NAME];
      if (sessionToken && typeof sessionToken === "string" && isValidToken(sessionToken)) {
        try {
          const session = await findActiveAuthSession(pool, sessionToken);
          if (session) {
            const csrfToken = deriveCsrfToken(authEnv.csrfSecret, "authenticated", sessionToken);
            return res.status(200).json({ csrfToken, context: "authenticated" });
          }
        } catch {
          return next(new ApiError(503, "NOT_READY", "Service unavailable."));
        }
      }

      const preToken = cookies[PRE_SESSION_COOKIE_NAME];
      if (preToken && typeof preToken === "string" && isValidToken(preToken)) {
        try {
          const preSession = await findPreAuthSession(pool, preToken);
          if (preSession) {
            const csrfToken = deriveCsrfToken(authEnv.csrfSecret, "pre-auth", preToken);
            return res.status(200).json({ csrfToken, context: "pre-auth" });
          }
        } catch {
          return next(new ApiError(503, "NOT_READY", "Service unavailable."));
        }
      }

      return next(new ApiError(401, "UNAUTHORIZED", "Not authenticated."));
    } catch (err) {
      next(err);
    }
  }) as RequestHandler);


  router.get("/auth/me", noStore, (async (req, res, next) => {
    if (!pool) {
      return next(new ApiError(503, "NOT_READY", "Service unavailable."));
    }

    let authEnv;
    try {
      authEnv = parseAuthEnv(process.env);
    } catch {
      return next(new ApiError(500, "INTERNAL_ERROR", "Authentication is not configured."));
    }
    if (!authEnv) {
      return next(new ApiError(500, "INTERNAL_ERROR", "Authentication is not configured."));
    }

    const cookies = parseCookies(req.headers.cookie);
    const sessionToken = cookies[SESSION_COOKIE_NAME];
    if (typeof sessionToken !== "string" || !isValidToken(sessionToken)) {
      return next(new ApiError(401, "UNAUTHORIZED", "Authentication required."));
    }

    let session;
    try {
      // This read-only lookup enforces idle and absolute expiry. Do not use
      // requireAuth here: its touchAuthSession call writes last_seen_at.
      session = await findActiveAuthSession(pool, sessionToken);
    } catch {
      return next(new ApiError(503, "NOT_READY", "Service unavailable."));
    }
    if (!session) {
      return next(new ApiError(401, "UNAUTHORIZED", "Authentication required."));
    }

    const csrfToken = deriveCsrfToken(authEnv.csrfSecret, "authenticated", sessionToken);
    return res.status(200).json({
      user: session.user,
      csrfToken,
    });
  }) as RequestHandler);

  router.post("/auth/logout", noStore, (async (req, res, next) => {
    if (!pool) {
      return next(new ApiError(503, "NOT_READY", "Service unavailable."));
    }

    let authEnv;
    try {
      authEnv = parseAuthEnv(process.env);
    } catch {
      return next(new ApiError(500, "INTERNAL_ERROR", "Authentication is not configured."));
    }
    if (!authEnv) {
      return next(new ApiError(500, "INTERNAL_ERROR", "Authentication is not configured."));
    }

    const origin = req.headers.origin as string | undefined;
    if (!isExactOriginAllowed(origin, authEnv.trustedOrigins)) {
      return next(new ApiError(403, "FORBIDDEN", "Origin not allowed."));
    }

    if (!req.is("application/json")) {
      return next(new ApiError(400, "INVALID_REQUEST", "Content-Type must be application/json."));
    }

    if (
      !req.body ||
      typeof req.body !== "object" ||
      Array.isArray(req.body) ||
      Object.keys(req.body).length !== 0
    ) {
      return next(new ApiError(400, "INVALID_REQUEST", "Request body must be an empty object."));
    }

    const cookies = parseCookies(req.headers.cookie);
    const sessionToken = cookies[SESSION_COOKIE_NAME];
    if (typeof sessionToken !== "string" || !isValidToken(sessionToken)) {
      return next(new ApiError(401, "UNAUTHORIZED", "Authentication required."));
    }

    const submittedCsrf = req.get("X-CSRF-Token");
    if (
      typeof submittedCsrf !== "string" ||
      !verifyCsrfToken(authEnv.csrfSecret, "authenticated", sessionToken, submittedCsrf)
    ) {
      return next(new ApiError(403, "FORBIDDEN", "CSRF validation failed."));
    }

    let session;
    try {
      session = await findActiveAuthSession(pool, sessionToken);
    } catch {
      return next(new ApiError(503, "NOT_READY", "Service unavailable."));
    }
    if (!session) {
      return next(new ApiError(401, "UNAUTHORIZED", "Authentication required."));
    }

    try {
      // Revoke only the session represented by this cookie. Logout does not
      // touch last_seen_at because the session is immediately invalidated.
      await revokeAuthSession(pool, session.session.id);
    } catch {
      return next(new ApiError(503, "NOT_READY", "Service unavailable."));
    }

    const clearCookie = serializeCookie(
      SESSION_COOKIE_NAME,
      "",
      { ...clearSessionCookieOptions(), maxAge: 0 },
    );
    res.setHeader("Set-Cookie", clearCookie);
    return res.status(204).end();
  }) as RequestHandler);

  return router;
}
