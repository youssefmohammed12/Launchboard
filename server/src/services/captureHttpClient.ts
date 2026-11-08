import * as http from 'node:http';
import * as https from 'node:https';
import type { IncomingHttpHeaders } from 'node:http';
import type { LookupFunction } from 'node:net';
import {
  CaptureSafetyError,
  parseCaptureTarget,
  resolvePublicCaptureAddresses,
  type CaptureDnsResolverFactory,
  type CaptureTarget,
  type ResolvedCaptureAddress,
} from './captureUrlSafety.js';

export const CAPTURE_HTTP_LIMITS = {
  totalTimeoutMs: 5000,
  dnsTimeoutMs: 1500,
  // Lever-hosted postings commonly exceed 512 KiB because the HTML includes
  // inline board assets and structured data. Keep the response strictly bounded.
  maxResponseBytes: 1024 * 1024,
  maxJsonResponseBytes: 2 * 1024 * 1024,
  maxXmlResponseBytes: 2 * 1024 * 1024,
  maxRedirects: 3,
  maxHeaderBytes: 8192,
  maxHeaderCount: 32,
} as const;

export type CaptureFetchFailureReason =
  | 'blocked'
  | 'not-found'
  | 'unsupported'
  | 'timeout'
  | 'too-large'
  | 'unavailable';

export class CaptureFetchError extends Error {
  constructor(readonly reason: CaptureFetchFailureReason) {
    super(reason);
    this.name = 'CaptureFetchError';
  }
}

export interface CaptureFetchedPage {
  html: string;
  finalUrl: string;
}

export interface CaptureRawHttpResponse {
  statusCode: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

export interface PinnedCaptureRequest {
  target: CaptureTarget;
  address: ResolvedCaptureAddress;
  timeoutMs: number;
  maxResponseBytes: number;
  method?: 'GET' | 'POST';
  body?: string;
  responseType?: 'html' | 'json' | 'xml';
}

export type CaptureRequestExecutor = (
  request: PinnedCaptureRequest,
) => Promise<CaptureRawHttpResponse>;

function createPinnedLookup(hostname: string, address: ResolvedCaptureAddress): LookupFunction {
  const expectedHost = hostname.toLowerCase();

  return (requestedHostname, options, callback) => {
    if (requestedHostname.toLowerCase() !== expectedHost) {
      const error = Object.assign(new Error('Pinned hostname mismatch.'), {
        code: 'EHOSTUNREACH',
      });
      callback(error, '', address.family);
      return;
    }

    if (options.all) {
      callback(null, [{ address: address.address, family: address.family }]);
      return;
    }

    callback(null, address.address, address.family);
  };
}

function responseHeader(
  headers: IncomingHttpHeaders,
  name: string,
): string | undefined {
  const value = headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function isHtmlContentType(headers: IncomingHttpHeaders): boolean {
  const contentType = responseHeader(headers, 'content-type');
  if (!contentType) return false;
  const mediaType = contentType.split(';', 1)[0]?.trim().toLowerCase();
  return mediaType === 'text/html' || mediaType === 'application/xhtml+xml';
}

function isJsonContentType(headers: IncomingHttpHeaders): boolean {
  const contentType = responseHeader(headers, 'content-type');
  if (!contentType) return false;
  const mediaType = contentType.split(';', 1)[0]?.trim().toLowerCase();
  return mediaType === 'application/json' || Boolean(mediaType?.endsWith('+json'));
}

function isXmlContentType(headers: IncomingHttpHeaders): boolean {
  const contentType = responseHeader(headers, 'content-type');
  if (!contentType) return false;
  const mediaType = contentType.split(';', 1)[0]?.trim().toLowerCase();
  return mediaType === 'application/xml' || mediaType === 'text/xml' || Boolean(mediaType?.endsWith('+xml'));
}

function isIdentityEncoding(headers: IncomingHttpHeaders): boolean {
  const encoding = responseHeader(headers, 'content-encoding');
  return encoding === undefined || encoding.trim().toLowerCase() === 'identity';
}

function contentLength(headers: IncomingHttpHeaders): number | null {
  const value = responseHeader(headers, 'content-length');
  if (value === undefined) return null;
  if (!/^\d+$/u.test(value.trim())) throw new CaptureFetchError('unsupported');
  const length = Number(value);
  if (!Number.isSafeInteger(length)) throw new CaptureFetchError('too-large');
  return length;
}

function isRedirect(statusCode: number): boolean {
  return [301, 302, 303, 307, 308].includes(statusCode);
}

function isRedirectTargetAllowed(current: URL, next: URL): boolean {
  if (next.protocol !== 'http:' && next.protocol !== 'https:') return false;
  if (current.protocol === 'https:' && next.protocol !== 'https:') return false;
  return true;
}

function requestPath(url: URL): string {
  return (url.pathname || '/') + url.search;
}

async function requestPinnedResource(
  request: PinnedCaptureRequest,
): Promise<CaptureRawHttpResponse> {
  const {
    target,
    address,
    timeoutMs,
    maxResponseBytes,
    method = 'GET',
    body,
    responseType = 'html',
  } = request;
  const lookup = createPinnedLookup(target.hostname, address);
  const agentOptions = {
    keepAlive: false,
    maxSockets: 1,
    maxTotalSockets: 1,
    lookup,
  };

  const agent = target.protocol === 'https:'
    ? new https.Agent(agentOptions)
    : new http.Agent(agentOptions);

  return new Promise<CaptureRawHttpResponse>((resolve, reject) => {
    let settled = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    const finish = (
      error: CaptureFetchError | null,
      response?: CaptureRawHttpResponse,
    ): void => {
      if (settled) return;
      settled = true;
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      agent.destroy();
      if (error) reject(error);
      else if (response) resolve(response);
      else reject(new CaptureFetchError('unavailable'));
    };

    const options: http.RequestOptions = {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      method,
      path: requestPath(target.url),
      agent,
      headers: {
        host: target.url.host,
        accept: responseType === 'json'
          ? 'application/json'
          : responseType === 'xml'
            ? 'application/xml,text/xml;q=0.9,application/*+xml;q=0.8'
            : 'text/html,application/xhtml+xml;q=0.9',
        'accept-encoding': 'identity',
        'user-agent': 'LaunchboardQuickCapture/1.0',
        connection: 'close',
        ...(method === 'POST'
          ? {
              'content-type': 'application/json',
              ...(body === undefined ? {} : { 'content-length': Buffer.byteLength(body, 'utf8') }),
            }
          : {}),
      },
      maxHeaderSize: CAPTURE_HTTP_LIMITS.maxHeaderBytes,
    };

    const responseHandler = (res: http.IncomingMessage): void => {
      if ((res.rawHeaders?.length ?? 0) > CAPTURE_HTTP_LIMITS.maxHeaderCount * 2) {
        res.destroy();
        finish(new CaptureFetchError('unsupported'));
        return;
      }

      const statusCode = res.statusCode ?? 0;
      const headers = res.headers;

      if (isRedirect(statusCode) || statusCode < 200 || statusCode >= 300) {
        res.resume();
        finish(null, { statusCode, headers, body: Buffer.alloc(0) });
        return;
      }

      const supportedContentType = responseType === 'json'
        ? isJsonContentType(headers)
        : responseType === 'xml'
          ? isXmlContentType(headers)
          : isHtmlContentType(headers);
      if (!supportedContentType || !isIdentityEncoding(headers)) {
        res.resume();
        finish(null, { statusCode, headers, body: Buffer.alloc(0) });
        return;
      }

      try {
        const length = contentLength(headers);
        if (length !== null && length > maxResponseBytes) {
          res.destroy();
          finish(new CaptureFetchError('too-large'));
          return;
        }
      } catch (error) {
        res.destroy();
        finish(
          error instanceof CaptureFetchError
            ? error
            : new CaptureFetchError('unsupported'),
        );
        return;
      }

      const chunks: Buffer[] = [];
      let totalBytes = 0;

      res.on('data', (chunk: Buffer | Uint8Array | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        totalBytes += buffer.length;
        if (totalBytes > maxResponseBytes) {
          res.destroy(new CaptureFetchError('too-large'));
          return;
        }
        chunks.push(buffer);
      });

      res.once('end', () => {
        finish(null, {
          statusCode,
          headers,
          body: Buffer.concat(chunks, totalBytes),
        });
      });

      res.once('aborted', () => finish(new CaptureFetchError('unavailable')));
      res.once('error', (error: unknown) => finish(
        error instanceof CaptureFetchError ? error : new CaptureFetchError('unavailable'),
      ));
    };

    const req = target.protocol === 'https:'
      ? https.request({
          ...options,
          servername: target.hostname,
          rejectUnauthorized: true,
          minVersion: 'TLSv1.2',
        }, responseHandler)
      : http.request(options, responseHandler);

    req.maxHeadersCount = CAPTURE_HTTP_LIMITS.maxHeaderCount;

    req.once('error', (error: unknown) => {
      if (error instanceof CaptureFetchError) {
        finish(error);
      } else {
        finish(new CaptureFetchError('unavailable'));
      }
    });

    timeoutHandle = setTimeout(() => {
      req.destroy(new CaptureFetchError('timeout'));
    }, timeoutMs);

    req.setTimeout(timeoutMs, () => {
      req.destroy(new CaptureFetchError('timeout'));
    });

    req.end(body);
  });
}

async function requestPinnedHtml(
  request: PinnedCaptureRequest,
): Promise<CaptureRawHttpResponse> {
  return requestPinnedResource({ ...request, responseType: 'html' });
}

async function requestPinnedJson(
  request: PinnedCaptureRequest,
): Promise<CaptureRawHttpResponse> {
  return requestPinnedResource({ ...request, responseType: 'json' });
}

async function requestPinnedXml(
  request: PinnedCaptureRequest,
): Promise<CaptureRawHttpResponse> {
  return requestPinnedResource({ ...request, responseType: 'xml' });
}

function mapSafetyFailure(error: CaptureSafetyError): CaptureFetchError {
  if (error.reason === 'dns-timeout') return new CaptureFetchError('timeout');
  if (error.reason === 'dns-failed') return new CaptureFetchError('unavailable');
  return new CaptureFetchError('blocked');
}

function mapStatus(statusCode: number): CaptureFetchError {
  if (statusCode === 404) return new CaptureFetchError('not-found');
  // Some career portals use 410 for request restrictions or human-verification
  // pages, so it is not sufficient evidence that the specific posting expired.
  if (statusCode === 410) return new CaptureFetchError('unavailable');
  if (statusCode === 401 || statusCode === 403 || statusCode === 429) {
    return new CaptureFetchError('blocked');
  }
  if (statusCode >= 500) return new CaptureFetchError('unavailable');
  return new CaptureFetchError('unsupported');
}

function requestKey(url: URL): string {
  return url.protocol + '//' + url.host + url.pathname + url.search;
}

async function requestForTarget(
  target: CaptureTarget,
  deadline: number,
  options: {
    createResolver?: CaptureDnsResolverFactory;
    request?: CaptureRequestExecutor;
    responseType?: 'html' | 'json' | 'xml';
    method?: 'GET' | 'POST';
    body?: string;
    maxResponseBytes?: number;
  },
): Promise<CaptureRawHttpResponse> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new CaptureFetchError('timeout');

  let addresses: ResolvedCaptureAddress[];
  try {
    addresses = await resolvePublicCaptureAddresses(target.hostname, {
      timeoutMs: Math.min(CAPTURE_HTTP_LIMITS.dnsTimeoutMs, remaining),
      ...(options.createResolver === undefined ? {} : { createResolver: options.createResolver }),
    });
  } catch (error) {
    if (error instanceof CaptureSafetyError) throw mapSafetyFailure(error);
    throw new CaptureFetchError('unavailable');
  }

  let lastError: CaptureFetchError | null = null;

  // Fallbacks may use only addresses from the validated DNS result. They never
  // trigger a second, uncontrolled lookup for the same hop.
  for (const address of addresses) {
    const timeout = deadline - Date.now();
    if (timeout <= 0) throw new CaptureFetchError('timeout');

    try {
      const executor = options.request ?? (
        options.responseType === 'json'
          ? requestPinnedJson
          : options.responseType === 'xml'
            ? requestPinnedXml
            : requestPinnedHtml
      );
      return await executor({
        target,
        address,
        timeoutMs: timeout,
        maxResponseBytes: options.maxResponseBytes ?? (
          options.responseType === 'json'
            ? CAPTURE_HTTP_LIMITS.maxJsonResponseBytes
            : options.responseType === 'xml'
              ? CAPTURE_HTTP_LIMITS.maxXmlResponseBytes
              : CAPTURE_HTTP_LIMITS.maxResponseBytes
        ),
        ...(options.method === undefined ? {} : { method: options.method }),
        ...(options.body === undefined ? {} : { body: options.body }),
        ...(options.responseType === undefined ? {} : { responseType: options.responseType }),
      });
    } catch (error) {
      const mapped = error instanceof CaptureFetchError
        ? error
        : new CaptureFetchError('unavailable');
      if (mapped.reason === 'timeout' || mapped.reason === 'too-large') throw mapped;
      lastError = mapped;
    }
  }

  throw lastError ?? new CaptureFetchError('unavailable');
}

/**
 * Fetches one bounded HTML document. Each redirect is resolved again and uses
 * a fresh Agent pinned to a previously validated public address.
 */
export async function fetchPublicCapturePage(
  inputUrl: string,
  options: {
    timeoutMs?: number;
    createResolver?: CaptureDnsResolverFactory;
    request?: CaptureRequestExecutor;
  } = {},
): Promise<CaptureFetchedPage> {
  const timeoutMs = options.timeoutMs ?? CAPTURE_HTTP_LIMITS.totalTimeoutMs;
  const deadline = Date.now() + timeoutMs;
  let currentUrl: URL;

  try {
    currentUrl = new URL(inputUrl);
  } catch {
    throw new CaptureFetchError('blocked');
  }

  const visited = new Set<string>();
  let redirectCount = 0;
  let previousProtocol: string | null = null;

  while (true) {
    if (Date.now() >= deadline) throw new CaptureFetchError('timeout');

    let target: CaptureTarget;
    try {
      target = parseCaptureTarget(currentUrl.toString());
    } catch (error) {
      if (error instanceof CaptureSafetyError) throw mapSafetyFailure(error);
      throw new CaptureFetchError('blocked');
    }

    if (previousProtocol === 'https:' && target.protocol !== 'https:') {
      throw new CaptureFetchError('blocked');
    }

    const key = requestKey(target.url);
    if (visited.has(key)) throw new CaptureFetchError('blocked');
    visited.add(key);

    const upstream = await requestForTarget(target, deadline, options);

    if (isRedirect(upstream.statusCode)) {
      const location = responseHeader(upstream.headers, 'location');
      if (!location || redirectCount >= CAPTURE_HTTP_LIMITS.maxRedirects) {
        throw new CaptureFetchError('blocked');
      }

      let nextUrl: URL;
      try {
        nextUrl = new URL(location, currentUrl);
      } catch {
        throw new CaptureFetchError('blocked');
      }

      if (!isRedirectTargetAllowed(currentUrl, nextUrl)) {
        throw new CaptureFetchError('blocked');
      }

      previousProtocol = currentUrl.protocol;
      currentUrl = nextUrl;
      redirectCount += 1;
      continue;
    }

    if (upstream.statusCode < 200 || upstream.statusCode >= 300) {
      throw mapStatus(upstream.statusCode);
    }

    if (!isHtmlContentType(upstream.headers) || !isIdentityEncoding(upstream.headers)) {
      throw new CaptureFetchError('unsupported');
    }

    if (upstream.body.length > CAPTURE_HTTP_LIMITS.maxResponseBytes) {
      throw new CaptureFetchError('too-large');
    }

    return {
      html: upstream.body.toString('utf8'),
      finalUrl: currentUrl.toString(),
    };
  }
}

export async function fetchPublicCaptureJson(
  inputUrl: string,
  options: {
    method?: 'GET' | 'POST';
    body?: unknown;
    timeoutMs?: number;
    maxResponseBytes?: number;
    createResolver?: CaptureDnsResolverFactory;
    request?: CaptureRequestExecutor;
  } = {},
): Promise<unknown> {
  const timeoutMs = options.timeoutMs ?? CAPTURE_HTTP_LIMITS.totalTimeoutMs;
  const deadline = Date.now() + timeoutMs;
  let target: CaptureTarget;

  try {
    target = parseCaptureTarget(inputUrl);
  } catch (error) {
    if (error instanceof CaptureSafetyError) throw mapSafetyFailure(error);
    throw new CaptureFetchError('blocked');
  }

  const body = options.body === undefined ? undefined : JSON.stringify(options.body);
  if (body !== undefined && Buffer.byteLength(body, 'utf8') > 4096) {
    throw new CaptureFetchError('too-large');
  }

  const response = await requestForTarget(target, deadline, {
    ...(options.createResolver === undefined ? {} : { createResolver: options.createResolver }),
    ...(options.request === undefined ? {} : { request: options.request }),
    responseType: 'json',
    method: options.method ?? 'GET',
    ...(body === undefined ? {} : { body }),
    maxResponseBytes: options.maxResponseBytes ?? CAPTURE_HTTP_LIMITS.maxJsonResponseBytes,
  });

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw mapStatus(response.statusCode);
  }
  if (!isJsonContentType(response.headers) || !isIdentityEncoding(response.headers)) {
    throw new CaptureFetchError('unsupported');
  }

  try {
    return JSON.parse(response.body.toString('utf8')) as unknown;
  } catch {
    throw new CaptureFetchError('unsupported');
  }
}

/**
 * Fetches one bounded XML document through the same DNS-pinned, no-credentials
 * transport as HTML and JSON. Redirects are intentionally not followed here.
 */
export async function fetchPublicCaptureXml(
  inputUrl: string,
  options: {
    timeoutMs?: number;
    maxResponseBytes?: number;
    createResolver?: CaptureDnsResolverFactory;
    request?: CaptureRequestExecutor;
  } = {},
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? CAPTURE_HTTP_LIMITS.totalTimeoutMs;
  const deadline = Date.now() + timeoutMs;
  let target: CaptureTarget;

  try {
    target = parseCaptureTarget(inputUrl);
  } catch (error) {
    if (error instanceof CaptureSafetyError) throw mapSafetyFailure(error);
    throw new CaptureFetchError('blocked');
  }

  const response = await requestForTarget(target, deadline, {
    ...(options.createResolver === undefined ? {} : { createResolver: options.createResolver }),
    ...(options.request === undefined ? {} : { request: options.request }),
    responseType: 'xml',
    maxResponseBytes: options.maxResponseBytes ?? CAPTURE_HTTP_LIMITS.maxXmlResponseBytes,
  });

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw mapStatus(response.statusCode);
  }
  if (!isXmlContentType(response.headers) || !isIdentityEncoding(response.headers)) {
    throw new CaptureFetchError('unsupported');
  }

  return response.body.toString('utf8');
}

export const captureHttpClientInternals = {
  createPinnedLookup,
  isHtmlContentType,
  isJsonContentType,
  isXmlContentType,
  isIdentityEncoding,
  requestPinnedHtml,
  requestPinnedJson,
  requestPath,
};
