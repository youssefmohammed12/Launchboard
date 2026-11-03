import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { SESSION_COOKIE_NAME } from '../auth/cookies.js';
import { generateToken } from '../auth/tokens.js';
import {
  findActiveAuthSession,
  touchAuthSession,
} from '../auth/sessionRepo.js';
import { createRequireAuth, type AuthenticatedRequest } from '../middleware/requireAuth.js';
import { withTestServer } from './helpers/server.js';

vi.mock('../auth/sessionRepo.js', () => ({
  findActiveAuthSession: vi.fn(),
  touchAuthSession: vi.fn(),
  findPreAuthSession: vi.fn(),
  createPreAuthSession: vi.fn(),
  revokePreAuthSession: vi.fn(),
  consumePreAuthSession: vi.fn(),
  createAuthSession: vi.fn(),
  revokeAuthSession: vi.fn(),
}));

const pool = {} as any;
const activeSession = {
  session: {
    id: 'session-123',
    userId: 'user-456',
    lastSeenAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
  },
  user: { id: 'user-456', email: 'person@example.test' },
};

function protectedApp() {
  return createApp({
    logErrors: false,
    registerRoutes: (app) => {
      app.all('/protected', createRequireAuth(pool), (req, res) => {
        const auth = (req as AuthenticatedRequest).auth;
        res.status(200).json({ ok: true, auth });
      });
    },
  });
}

function cookie(token: string): string {
  return `${SESSION_COOKIE_NAME}=${token}`;
}

describe('requireAuth HTTP integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(findActiveAuthSession).mockResolvedValue(null);
    vi.mocked(touchAuthSession).mockResolvedValue(false);
  });

  it('returns 401 when the session cookie is missing', async () => {
    await withTestServer(protectedApp(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/protected`);
      expect(response.status).toBe(401);
      expect(findActiveAuthSession).not.toHaveBeenCalled();
      expect(touchAuthSession).not.toHaveBeenCalled();
    });
  });

  it('rejects malformed tokens without querying the database', async () => {
    await withTestServer(protectedApp(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/protected`, {
        headers: { Cookie: cookie('not-a-valid-session-token') },
      });
      expect(response.status).toBe(401);
      expect(findActiveAuthSession).not.toHaveBeenCalled();
      expect(touchAuthSession).not.toHaveBeenCalled();
    });
  });

  it('authenticates a valid session and exposes only the database-derived identity', async () => {
    const token = generateToken();
    vi.mocked(findActiveAuthSession).mockResolvedValue(activeSession);
    vi.mocked(touchAuthSession).mockResolvedValue(true);

    await withTestServer(protectedApp(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/protected`, {
        method: 'POST',
        headers: { Cookie: cookie(token) },
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        ok: true,
        auth: {
          sessionId: 'session-123',
          userId: 'user-456',
          user: { id: 'user-456', email: 'person@example.test' },
        },
      });
      expect(findActiveAuthSession).toHaveBeenCalledOnce();
      expect(findActiveAuthSession).toHaveBeenCalledWith(pool, token);
      expect(touchAuthSession).toHaveBeenCalledOnce();
      expect(touchAuthSession).toHaveBeenCalledWith(pool, 'session-123');
    });
  });

  it.each(['GET', 'HEAD', 'OPTIONS'])('keeps %s authentication read-only', async (method) => {
    const token = generateToken();
    vi.mocked(findActiveAuthSession).mockResolvedValue(activeSession);

    await withTestServer(protectedApp(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/protected`, {
        method,
        headers: { Cookie: cookie(token) },
      });

      expect(response.status).toBe(200);
      expect(findActiveAuthSession).toHaveBeenCalledWith(pool, token);
      expect(touchAuthSession).not.toHaveBeenCalled();
    });
  });

  it('returns 401 when the session is unknown or expired', async () => {
    const token = generateToken();
    vi.mocked(findActiveAuthSession).mockResolvedValue(null);

    await withTestServer(protectedApp(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/protected`, {
        headers: { Cookie: cookie(token) },
      });
      expect(response.status).toBe(401);
      expect(findActiveAuthSession).toHaveBeenCalledWith(pool, token);
      expect(touchAuthSession).not.toHaveBeenCalled();
    });
  });

  it('returns a safe 503 when the session lookup fails', async () => {
    const token = generateToken();
    vi.mocked(findActiveAuthSession).mockRejectedValue(
      new Error('ER_ACCESS_DENIED_ERROR: private database diagnostics'),
    );

    await withTestServer(protectedApp(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/protected`, {
        headers: { Cookie: cookie(token) },
      });
      const text = await response.text();
      expect(response.status).toBe(503);
      expect(text).not.toContain('ER_ACCESS_DENIED_ERROR');
      expect(text).not.toContain('private database diagnostics');
      expect(touchAuthSession).not.toHaveBeenCalled();
    });
  });

  it('returns 401 when the conditional session touch confirms the session is no longer active', async () => {
    const token = generateToken();
    vi.mocked(findActiveAuthSession).mockResolvedValue(activeSession);
    vi.mocked(touchAuthSession).mockResolvedValue(false);

    await withTestServer(protectedApp(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/protected`, {
        method: 'POST',
        headers: { Cookie: cookie(token) },
      });
      expect(response.status).toBe(401);
      expect(touchAuthSession).toHaveBeenCalledWith(pool, 'session-123');
    });
  });

  it('returns a safe 503 when touching the session fails', async () => {
    const token = generateToken();
    vi.mocked(findActiveAuthSession).mockResolvedValue(activeSession);
    vi.mocked(touchAuthSession).mockRejectedValue(
      new Error('ER_LOCK_WAIT_TIMEOUT: private database diagnostics'),
    );

    await withTestServer(protectedApp(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/protected`, {
        method: 'POST',
        headers: { Cookie: cookie(token) },
      });
      const text = await response.text();
      expect(response.status).toBe(503);
      expect(text).not.toContain('ER_LOCK_WAIT_TIMEOUT');
      expect(text).not.toContain('private database diagnostics');
      expect(touchAuthSession).toHaveBeenCalledWith(pool, 'session-123');
    });
  });
});
