import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import {
  CAPTURE_HTTP_LIMITS,
  CaptureFetchError,
  captureHttpClientInternals,
  fetchPublicCaptureJson,
  fetchPublicCapturePage,
  fetchPublicCaptureXml,
  type CaptureRequestExecutor,
  type PinnedCaptureRequest,
} from '../services/captureHttpClient.js';
import { parseCaptureTarget, type CaptureDnsResolverFactory } from '../services/captureUrlSafety.js';

function publicResolverFactory(hostnames: string[] = []): CaptureDnsResolverFactory {
  return () => ({
    resolve4: async (hostname) => {
      hostnames.push(hostname);
      return ['1.1.1.1'];
    },
    resolve6: async () => {
      throw Object.assign(new Error('no IPv6 record'), { code: 'ENODATA' });
    },
    cancel: () => undefined,
  });
}

function response(
  statusCode: number,
  headers: Record<string, string>,
  body = '',
) {
  return {
    statusCode,
    headers,
    body: Buffer.from(body, 'utf8'),
  };
}

describe('pinned HTTP transport helpers', () => {
  it('returns only the previously validated address for the original hostname', () => {
    const lookup = captureHttpClientInternals.createPinnedLookup(
      'jobs.example.com',
      { address: '1.1.1.1', family: 4 },
    );
    const callback = vi.fn();

    lookup('jobs.example.com', { family: 0, hints: 0, all: false, verbatim: true }, callback);
    expect(callback).toHaveBeenCalledWith(null, '1.1.1.1', 4);

    const mismatchCallback = vi.fn();
    lookup('attacker.internal', { family: 0, hints: 0, all: false, verbatim: true }, mismatchCallback);
    expect(mismatchCallback.mock.calls[0]?.[0]).toMatchObject({ code: 'EHOSTUNREACH' });
  });

  it('connects to the pinned IP while preserving the hostname and fixed outbound headers', async () => {
    let remoteAddress = '';
    let receivedHeaders: Record<string, string | string[] | undefined> = {};
    const server = createServer((request, response) => {
      remoteAddress = request.socket.remoteAddress ?? '';
      receivedHeaders = request.headers;
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end('<html>pinned</html>');
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });

    try {
      const address = server.address() as AddressInfo;
      const target = {
        ...parseCaptureTarget('http://jobs.example.com/capture?job=1'),
        port: address.port,
      };

      const result = await captureHttpClientInternals.requestPinnedHtml({
        target,
        address: { address: '127.0.0.1', family: 4 },
        timeoutMs: 1000,
        maxResponseBytes: 1024,
      });

      expect(result.statusCode).toBe(200);
      expect(result.body.toString('utf8')).toBe('<html>pinned</html>');
      expect(remoteAddress).toContain('127.0.0.1');
      expect(receivedHeaders.host).toBe('jobs.example.com');
      expect(receivedHeaders['user-agent']).toBe('LaunchboardQuickCapture/1.0');
      expect(receivedHeaders.accept).toContain('text/html');
      expect(receivedHeaders['accept-encoding']).toBe('identity');
      expect(receivedHeaders.cookie).toBeUndefined();
      expect(receivedHeaders.authorization).toBeUndefined();
      expect(receivedHeaders.referer).toBeUndefined();
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it('sends a bounded JSON POST through the pinned address without ambient credentials', async () => {
    let received: {
      method?: string;
      host?: string;
      contentType?: string;
      accept?: string;
      cookie?: string;
      authorization?: string;
      body: string;
    } = { body: '' };
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        received = {
          method: request.method,
          host: request.headers.host,
          contentType: request.headers['content-type'],
          accept: request.headers.accept,
          cookie: request.headers.cookie,
          authorization: request.headers.authorization,
          body: Buffer.concat(chunks).toString('utf8'),
        };
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ jobs: [{ title: 'Software Engineer' }] }));
      });
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });

    try {
      const address = server.address() as AddressInfo;
      const target = {
        ...parseCaptureTarget('http://api.example.com/wday/cxs/acme/External/jobs'),
        port: address.port,
      };
      const result = await captureHttpClientInternals.requestPinnedJson({
        target,
        address: { address: '127.0.0.1', family: 4 },
        timeoutMs: 1000,
        maxResponseBytes: 1024,
        method: 'POST',
        body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: 'Engineer' }),
      });

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body.toString('utf8'))).toEqual({
        jobs: [{ title: 'Software Engineer' }],
      });
      expect(received).toMatchObject({
        method: 'POST',
        host: 'api.example.com',
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: 'Engineer' }),
      });
      expect(received.cookie).toBeUndefined();
      expect(received.authorization).toBeUndefined();
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it('parses JSON only from a validated public destination and keeps the response size bounded', async () => {
    const request = vi.fn<CaptureRequestExecutor>(async (input) => {
      expect(input.method).toBe('POST');
      expect(input.responseType).toBe('json');
      expect(input.maxResponseBytes).toBe(CAPTURE_HTTP_LIMITS.maxJsonResponseBytes);
      return response(200, { 'content-type': 'application/json' }, JSON.stringify({ ok: true }));
    });

    await expect(fetchPublicCaptureJson('https://api.example.com/jobs', {
      method: 'POST',
      body: { searchText: 'Engineer' },
      request,
      createResolver: publicResolverFactory(),
    })).resolves.toEqual({ ok: true });
    expect(request).toHaveBeenCalledOnce();

    await expect(fetchPublicCaptureJson('https://127.0.0.1/jobs', {
      request,
      createResolver: publicResolverFactory(),
    })).rejects.toMatchObject({ reason: 'blocked' });
    expect(request).toHaveBeenCalledOnce();

    const nonJson: CaptureRequestExecutor = async () =>
      response(200, { 'content-type': 'text/html' }, '<html>not JSON</html>');
    await expect(fetchPublicCaptureJson('https://api.example.com/jobs', {
      request: nonJson,
      createResolver: publicResolverFactory(),
    })).rejects.toMatchObject({ reason: 'unsupported' });
  });

  it('fetches bounded XML from a validated public destination through the pinned transport', async () => {
    const xml = '<?xml version="1.0"?><workzag-jobs><position><id>123</id></position></workzag-jobs>';
    const request = vi.fn<CaptureRequestExecutor>(async (input) => {
      expect(input.responseType).toBe('xml');
      expect(input.maxResponseBytes).toBe(CAPTURE_HTTP_LIMITS.maxXmlResponseBytes);
      return response(200, { 'content-type': 'application/xml; charset=utf-8' }, xml);
    });

    await expect(fetchPublicCaptureXml('https://acme.jobs.personio.de/xml?language=en', {
      request,
      createResolver: publicResolverFactory(),
    })).resolves.toBe(xml);
    expect(request).toHaveBeenCalledOnce();

    const wrongType: CaptureRequestExecutor = async () =>
      response(200, { 'content-type': 'text/html' }, '<html>not XML</html>');
    await expect(fetchPublicCaptureXml('https://acme.jobs.personio.de/xml?language=en', {
      request: wrongType,
      createResolver: publicResolverFactory(),
    })).rejects.toMatchObject({ reason: 'unsupported' });

    const blockedRequest = vi.fn<CaptureRequestExecutor>();
    await expect(fetchPublicCaptureXml('https://127.0.0.1/xml?language=en', {
      request: blockedRequest,
      createResolver: publicResolverFactory(),
    })).rejects.toMatchObject({ reason: 'blocked' });
    expect(blockedRequest).not.toHaveBeenCalled();
  });

  it('rejects oversized JSON request bodies before making a network request', async () => {
    const request = vi.fn<CaptureRequestExecutor>();

    await expect(fetchPublicCaptureJson('https://api.example.com/jobs', {
      method: 'POST',
      body: { data: 'x'.repeat(4096) },
      request,
      createResolver: publicResolverFactory(),
    })).rejects.toMatchObject({ reason: 'too-large' });
    expect(request).not.toHaveBeenCalled();
  });

  it('classifies 404 as not-found but keeps ambiguous 410 responses unavailable', async () => {
    const missing: CaptureRequestExecutor = async () =>
      response(404, { 'content-type': 'application/json' }, '{}');
    const goneOrRestricted: CaptureRequestExecutor = async () =>
      response(410, { 'content-type': 'application/json' }, '{}');

    await expect(fetchPublicCaptureJson('https://api.example.com/jobs/missing', {
      request: missing,
      createResolver: publicResolverFactory(),
    })).rejects.toMatchObject({ reason: 'not-found' });

    await expect(fetchPublicCaptureJson('https://api.example.com/jobs/restricted', {
      request: goneOrRestricted,
      createResolver: publicResolverFactory(),
    })).rejects.toMatchObject({ reason: 'unavailable' });
  });

  it('supports all-address lookup requests without performing DNS', () => {
    const lookup = captureHttpClientInternals.createPinnedLookup(
      'jobs.example.com',
      { address: '2606:4700:4700::1111', family: 6 },
    );
    const callback = vi.fn();

    lookup('jobs.example.com', { family: 0, hints: 0, all: true, verbatim: true }, callback);
    expect(callback).toHaveBeenCalledWith(null, [
      { address: '2606:4700:4700::1111', family: 6 },
    ]);
  });

  it('never sends a URL fragment in the outbound HTTP request target', () => {
    expect(captureHttpClientInternals.requestPath(
      new URL('https://jobs.example.com/roles/123?source=mail#/jobs/456'),
    )).toBe('/roles/123?source=mail');
  });

  it('accepts only HTML and identity content encoding', () => {
    expect(captureHttpClientInternals.isHtmlContentType({
      'content-type': 'text/html; charset=utf-8',
    })).toBe(true);
    expect(captureHttpClientInternals.isHtmlContentType({
      'content-type': 'application/pdf',
    })).toBe(false);
    expect(captureHttpClientInternals.isIdentityEncoding({
      'content-encoding': 'identity',
    })).toBe(true);
    expect(captureHttpClientInternals.isIdentityEncoding({
      'content-encoding': 'gzip',
    })).toBe(false);
  });
});

describe('bounded public-page fetch orchestration', () => {
  it('fetches one HTML page and returns its final URL', async () => {
    const request = vi.fn<CaptureRequestExecutor>(async () =>
      response(200, { 'content-type': 'text/html; charset=utf-8' }, '<html>safe</html>'),
    );

    await expect(fetchPublicCapturePage('https://jobs.example.com/roles/123', {
      request,
      createResolver: publicResolverFactory(),
    })).resolves.toEqual({
      html: '<html>safe</html>',
      finalUrl: 'https://jobs.example.com/roles/123',
    });
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0]?.[0].address).toEqual({ address: '1.1.1.1', family: 4 });
  });

  it('accepts common job-board HTML larger than the previous 512 KiB cap while staying bounded', async () => {
    const body = 'x'.repeat(700 * 1024);
    const request: CaptureRequestExecutor = async () =>
      response(200, { 'content-type': 'text/html; charset=utf-8' }, body);

    const result = await fetchPublicCapturePage('https://jobs.example.com/large-posting', {
      request,
      createResolver: publicResolverFactory(),
    });

    expect(CAPTURE_HTTP_LIMITS.maxResponseBytes).toBe(1024 * 1024);
    expect(Buffer.byteLength(result.html)).toBe(700 * 1024);
  });

  it('re-resolves and revalidates every manual redirect target', async () => {
    const resolvedHosts: string[] = [];
    const requests: PinnedCaptureRequest[] = [];
    const request: CaptureRequestExecutor = async (input) => {
      requests.push(input);
      if (requests.length === 1) {
        return response(302, { location: 'https://cdn.example.net/final' });
      }
      return response(200, { 'content-type': 'text/html' }, 'final body');
    };

    const result = await fetchPublicCapturePage('https://jobs.example.com/start', {
      request,
      createResolver: publicResolverFactory(resolvedHosts),
    });

    expect(result).toEqual({
      html: 'final body',
      finalUrl: 'https://cdn.example.net/final',
    });
    expect(resolvedHosts).toEqual(['jobs.example.com', 'cdn.example.net']);
    expect(requests).toHaveLength(2);
    expect(requests[0]?.target.hostname).toBe('jobs.example.com');
    expect(requests[1]?.target.hostname).toBe('cdn.example.net');
  });

  it('rejects redirects to private or local destinations before a second request', async () => {
    const request = vi.fn<CaptureRequestExecutor>(async () =>
      response(302, { location: 'http://127.0.0.1/admin' }),
    );

    await expect(fetchPublicCapturePage('https://jobs.example.com/start', {
      request,
      createResolver: publicResolverFactory(),
    })).rejects.toMatchObject({ reason: 'blocked' });
    expect(request).toHaveBeenCalledOnce();
  });

  it('rejects HTTPS-to-HTTP downgrade redirects', async () => {
    const request = vi.fn<CaptureRequestExecutor>(async () =>
      response(302, { location: 'http://jobs.example.net/target' }),
    );

    await expect(fetchPublicCapturePage('https://jobs.example.com/start', {
      request,
      createResolver: publicResolverFactory(),
    })).rejects.toMatchObject({ reason: 'blocked' });
    expect(request).toHaveBeenCalledOnce();
  });

  it('rejects redirect loops and excessive redirects', async () => {
    const loopRequest: CaptureRequestExecutor = async () =>
      response(302, { location: 'https://jobs.example.com/start' });

    await expect(fetchPublicCapturePage('https://jobs.example.com/start', {
      request: loopRequest,
      createResolver: publicResolverFactory(),
    })).rejects.toMatchObject({ reason: 'blocked' });

    let redirect = 0;
    const tooMany: CaptureRequestExecutor = async () => {
      redirect += 1;
      return response(302, { location: 'https://jobs' + redirect + '.example.com/next' });
    };

    await expect(fetchPublicCapturePage('https://jobs.example.com/start', {
      request: tooMany,
      createResolver: publicResolverFactory(),
    })).rejects.toMatchObject({ reason: 'blocked' });
    expect(redirect).toBe(CAPTURE_HTTP_LIMITS.maxRedirects + 1);
  });

  it('rejects non-HTML, compressed and unsuccessful upstream responses', async () => {
    const nonHtml: CaptureRequestExecutor = async () =>
      response(200, { 'content-type': 'application/pdf' }, 'PDF');
    await expect(fetchPublicCapturePage('https://jobs.example.com/file', {
      request: nonHtml,
      createResolver: publicResolverFactory(),
    })).rejects.toMatchObject({ reason: 'unsupported' });

    const compressed: CaptureRequestExecutor = async () =>
      response(200, {
        'content-type': 'text/html',
        'content-encoding': 'gzip',
      }, 'not actually gzip');
    await expect(fetchPublicCapturePage('https://jobs.example.com/file', {
      request: compressed,
      createResolver: publicResolverFactory(),
    })).rejects.toMatchObject({ reason: 'unsupported' });

    const forbidden: CaptureRequestExecutor = async () =>
      response(403, {}, 'blocked page content is not exposed');
    await expect(fetchPublicCapturePage('https://jobs.example.com/file', {
      request: forbidden,
      createResolver: publicResolverFactory(),
    })).rejects.toMatchObject({ reason: 'blocked' });
  });

  it('enforces the streamed response byte cap for injected transports too', async () => {
    const oversized: CaptureRequestExecutor = async () =>
      response(200, { 'content-type': 'text/html' }, 'x'.repeat(CAPTURE_HTTP_LIMITS.maxResponseBytes + 1));

    await expect(fetchPublicCapturePage('https://jobs.example.com/file', {
      request: oversized,
      createResolver: publicResolverFactory(),
    })).rejects.toMatchObject({ reason: 'too-large' });
  });

  it('keeps only safe failure categories and never echoes destination details', async () => {
    const unsafe = await fetchPublicCapturePage('https://127.0.0.1/admin', {
      request: async () => response(200, { 'content-type': 'text/html' }, 'irrelevant'),
      createResolver: publicResolverFactory(),
    }).catch((error: unknown) => error);

    expect(unsafe).toBeInstanceOf(CaptureFetchError);
    expect(unsafe).toMatchObject({ reason: 'blocked' });
    expect(String(unsafe)).not.toContain('127.0.0.1');
  });
});
