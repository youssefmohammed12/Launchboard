import { Resolver } from 'node:dns/promises';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';

const IPV6_GLOBAL_UNICAST = ipaddr.IPv6.parseCIDR('2000::/3');
const BLOCKED_IPV6_CIDRS = [
  '2001::/23',
  '2002::/16',
  '2620:4f:8000::/48',
  '3fff::/20',
  '5f00::/16',
].map((cidr) => ipaddr.IPv6.parseCIDR(cidr));

const BLOCKED_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.home.arpa',
  '.lan',
  '.localdomain',
  '.onion',
  '.test',
  '.example',
  '.invalid',
] as const;

export type CaptureSafetyReason =
  | 'invalid-url'
  | 'unsupported-scheme'
  | 'credentials-not-allowed'
  | 'unsupported-port'
  | 'unsafe-hostname'
  | 'dns-failed'
  | 'dns-timeout'
  | 'unsafe-address';

export class CaptureSafetyError extends Error {
  constructor(readonly reason: CaptureSafetyReason) {
    super(reason);
    this.name = 'CaptureSafetyError';
  }
}

export interface CaptureTarget {
  url: URL;
  hostname: string;
  port: number;
  protocol: 'http:' | 'https:';
}

export interface ResolvedCaptureAddress {
  address: string;
  family: 4 | 6;
}

export interface CaptureDnsResolver {
  resolve4(hostname: string): Promise<string[]>;
  resolve6(hostname: string): Promise<string[]>;
  cancel(): void;
}

export type CaptureDnsResolverFactory = (options: {
  timeout: number;
  tries: number;
}) => CaptureDnsResolver;

const createSystemResolver: CaptureDnsResolverFactory = (options) =>
  new Resolver(options);

function isBlockedHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === 'home.arpa' ||
    BLOCKED_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  );
}

/**
 * Parses and constrains a destination before DNS resolution. IP literals are
 * rejected outright so every allowed destination passes the same DNS policy.
 */
export function parseCaptureTarget(value: string): CaptureTarget {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CaptureSafetyError('invalid-url');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new CaptureSafetyError('unsupported-scheme');
  }

  if (url.username || url.password) {
    throw new CaptureSafetyError('credentials-not-allowed');
  }

  const protocol = url.protocol;
  const port = url.port
    ? Number(url.port)
    : protocol === 'https:'
      ? 443
      : 80;

  if (
    !Number.isInteger(port) ||
    (protocol === 'https:' && port !== 443) ||
    (protocol === 'http:' && port !== 80)
  ) {
    throw new CaptureSafetyError('unsupported-port');
  }

  const hostname = url.hostname
    .replace(/^\[/u, '')
    .replace(/\]$/u, '')
    .toLowerCase();

  if (
    hostname.length === 0 ||
    hostname.length > 253 ||
    hostname.endsWith('.') ||
    isIP(hostname) !== 0 ||
    isBlockedHostname(hostname)
  ) {
    throw new CaptureSafetyError('unsafe-hostname');
  }

  const labels = hostname.split('.');
  if (
    labels.length < 2 ||
    labels.some((label) =>
      label.length === 0 ||
      label.length > 63 ||
      !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label),
    )
  ) {
    throw new CaptureSafetyError('unsafe-hostname');
  }

  return { url, hostname, port, protocol };
}

/**
 * Only global unicast addresses are acceptable. ipaddr.js classifies IANA
 * special-purpose ranges (private, CGNAT, benchmarking, documentation,
 * transition, multicast, reserved and so on) separately from public unicast.
 */
export function isPublicInternetAddress(value: string): boolean {
  if (isIP(value) === 0) return false;

  try {
    const address = ipaddr.parse(value);
    if (isIP(value) === 6) {
      const ipv6Address = ipaddr.IPv6.parse(value);
      if (
        ipv6Address.zoneId ||
        ipv6Address.isIPv4MappedAddress() ||
        !ipv6Address.match(IPV6_GLOBAL_UNICAST) ||
        BLOCKED_IPV6_CIDRS.some((range) => ipv6Address.match(range))
      ) return false;
    }
    return address.range() === 'unicast';
  } catch {
    return false;
  }
}

function addressFamily(value: string): 4 | 6 | null {
  const family = isIP(value);
  return family === 4 || family === 6 ? family : null;
}

function isNoData(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === 'ENODATA'
  );
}

/**
 * Resolves both address families and fails closed if either lookup has a real
 * DNS error, if no address is returned, or if any answer is non-global.
 *
 * Tests can inject a deterministic resolver. The production resolver is
 * cancellable and has a short explicit timeout rather than inheriting an
 * unbounded system lookup.
 */
export async function resolvePublicCaptureAddresses(
  hostname: string,
  options: {
    timeoutMs?: number;
    createResolver?: CaptureDnsResolverFactory;
  } = {},
): Promise<ResolvedCaptureAddress[]> {
  const timeoutMs = options.timeoutMs ?? 1500;
  const resolver = (options.createResolver ?? createSystemResolver)({
    timeout: timeoutMs,
    tries: 1,
  });

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const lookups = Promise.all([
    resolver.resolve4(hostname).then(
      (addresses) => ({ addresses, failed: false as const }),
      (error: unknown) => ({ addresses: [] as string[], error, failed: true as const }),
    ),
    resolver.resolve6(hostname).then(
      (addresses) => ({ addresses, failed: false as const }),
      (error: unknown) => ({ addresses: [] as string[], error, failed: true as const }),
    ),
  ]);

  try {
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutHandle = setTimeout(() => {
        resolver.cancel();
        reject(new CaptureSafetyError('dns-timeout'));
      }, timeoutMs);
    });

    const results = await Promise.race([lookups, timeout]);

    for (const result of results) {
      if (result.failed && !isNoData(result.error)) {
        throw new CaptureSafetyError('dns-failed');
      }
    }

    const addresses = [
      ...results[0].addresses,
      ...results[1].addresses,
    ];
    if (addresses.length === 0) {
      throw new CaptureSafetyError('dns-failed');
    }

    const uniqueAddresses = [...new Set(addresses)];
    const resolved: ResolvedCaptureAddress[] = [];

    for (const address of uniqueAddresses) {
      const family = addressFamily(address);
      if (family === null || !isPublicInternetAddress(address)) {
        throw new CaptureSafetyError('unsafe-address');
      }
      resolved.push({ address, family });
    }

    return resolved;
  } catch (error) {
    if (error instanceof CaptureSafetyError) throw error;
    throw new CaptureSafetyError('dns-failed');
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  }
}
