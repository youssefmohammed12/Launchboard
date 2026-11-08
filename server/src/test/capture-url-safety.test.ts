import { describe, expect, it, vi } from 'vitest';
import {
  isPublicInternetAddress,
  parseCaptureTarget,
  resolvePublicCaptureAddresses,
  type CaptureDnsResolver,
  type CaptureDnsResolverFactory,
} from '../services/captureUrlSafety.js';

function fakeResolver(
  ipv4: string[] | Error,
  ipv6: string[] | Error,
  onCancel: () => void = () => undefined,
): CaptureDnsResolver {
  return {
    resolve4: async () => {
      if (ipv4 instanceof Error) throw ipv4;
      return ipv4;
    },
    resolve6: async () => {
      if (ipv6 instanceof Error) throw ipv6;
      return ipv6;
    },
    cancel: onCancel,
  };
}

function resolverFactory(
  ipv4: string[] | Error,
  ipv6: string[] | Error,
  onCancel?: () => void,
): CaptureDnsResolverFactory {
  return () => fakeResolver(ipv4, ipv6, onCancel);
}

describe('capture target validation', () => {
  it('accepts only ordinary public-domain HTTP and HTTPS targets on standard ports', () => {
    expect(parseCaptureTarget('https://jobs.example.com/opportunities/123')).toMatchObject({
      hostname: 'jobs.example.com',
      port: 443,
      protocol: 'https:',
    });
    expect(parseCaptureTarget('http://jobs.example.com:80/opportunities/123')).toMatchObject({
      hostname: 'jobs.example.com',
      port: 80,
      protocol: 'http:',
    });
  });

  it.each([
    ['malformed URL', 'not a url', 'invalid-url'],
    ['FTP', 'ftp://jobs.example.com/123', 'unsupported-scheme'],
    ['embedded username', 'https://user@jobs.example.com/123', 'credentials-not-allowed'],
    ['embedded password', 'https://user:pass@jobs.example.com/123', 'credentials-not-allowed'],
    ['HTTPS custom port', 'https://jobs.example.com:8443/123', 'unsupported-port'],
    ['HTTP TLS port', 'http://jobs.example.com:443/123', 'unsupported-port'],
    ['localhost', 'http://localhost/123', 'unsafe-hostname'],
    ['local suffix', 'https://jobs.company.local/123', 'unsafe-hostname'],
    ['internal suffix', 'https://metadata.internal/123', 'unsafe-hostname'],
    ['home.arpa host', 'https://router.home.arpa/123', 'unsafe-hostname'],
    ['home.arpa apex', 'https://home.arpa/123', 'unsafe-hostname'],
    ['single-label host', 'https://intranet/123', 'unsafe-hostname'],
    ['trailing dot', 'https://jobs.example.com./123', 'unsafe-hostname'],
    ['IPv4 literal', 'https://8.8.8.8/123', 'unsafe-hostname'],
    ['alternate IPv4 encoding', 'http://2130706433/123', 'unsafe-hostname'],
    ['IPv6 literal', 'https://[2606:4700:4700::1111]/123', 'unsafe-hostname'],
  ] as const)('rejects %s', (_name, url, reason) => {
    expect(() => parseCaptureTarget(url)).toThrowError(
      expect.objectContaining({ reason }),
    );
  });
});

describe('global-unicast address classification', () => {
  it.each([
    '1.1.1.1',
    '8.8.8.8',
    '93.184.216.34',
    '2606:4700:4700::1111',
    '2001:4860:4860::8888',
  ])('accepts public address %s', (address) => {
    expect(isPublicInternetAddress(address)).toBe(true);
  });

  it.each([
    '0.0.0.0',
    '10.0.0.1',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '192.0.2.1',
    '192.168.0.1',
    '198.18.0.1',
    '198.51.100.1',
    '203.0.113.1',
    '224.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    'fc00::1',
    'fe80::1',
    'ff02::1',
    '::ffff:8.8.8.8',
    '2002:0808::1',
    '2001:0000::1',
    '64:ff9b::c0a8:1',
    '64:ff9b:1::c0a8:1',
    '100::1',
    '100:0:0:1::1',
    '2001:20::1',
    '2620:4f:8000::1',
    '3fff::1',
    '5f00::1',
    'not-an-ip',
  ])('rejects non-global or invalid address %s', (address) => {
    expect(isPublicInternetAddress(address)).toBe(false);
  });
});

describe('DNS address validation', () => {
  it('returns unique IPv4 and IPv6 answers only when every answer is global unicast', async () => {
    await expect(resolvePublicCaptureAddresses('jobs.example.com', {
      createResolver: resolverFactory(['1.1.1.1', '1.1.1.1'], ['2606:4700:4700::1111']),
    })).resolves.toEqual([
      { address: '1.1.1.1', family: 4 },
      { address: '2606:4700:4700::1111', family: 6 },
    ]);
  });

  it('accepts one empty address family when the other returns public addresses', async () => {
    await expect(resolvePublicCaptureAddresses('jobs.example.com', {
      createResolver: resolverFactory(['1.1.1.1'], Object.assign(new Error('no data'), { code: 'ENODATA' })),
    })).resolves.toEqual([{ address: '1.1.1.1', family: 4 }]);
  });

  it('rejects mixed public/private DNS answers instead of selecting only the public one', async () => {
    await expect(resolvePublicCaptureAddresses('jobs.example.com', {
      createResolver: resolverFactory(['1.1.1.1'], ['::1']),
    })).rejects.toMatchObject({ reason: 'unsafe-address' });
  });

  it('rejects hosts with no A or AAAA records', async () => {
    const noData = Object.assign(new Error('no data'), { code: 'ENODATA' });
    await expect(resolvePublicCaptureAddresses('jobs.example.com', {
      createResolver: resolverFactory(noData, noData),
    })).rejects.toMatchObject({ reason: 'dns-failed' });
  });

  it('rejects DNS failures other than an empty address family', async () => {
    const failure = Object.assign(new Error('resolver failed'), { code: 'ETIMEOUT' });
    await expect(resolvePublicCaptureAddresses('jobs.example.com', {
      createResolver: resolverFactory(failure, ['2606:4700:4700::1111']),
    })).rejects.toMatchObject({ reason: 'dns-failed' });
  });

  it('cancels DNS queries when the bounded resolver timeout is reached', async () => {
    const cancel = vi.fn();
    const slowFactory: CaptureDnsResolverFactory = () => ({
      resolve4: () => new Promise<string[]>(() => undefined),
      resolve6: () => new Promise<string[]>(() => undefined),
      cancel,
    });

    await expect(resolvePublicCaptureAddresses('jobs.example.com', {
      timeoutMs: 5,
      createResolver: slowFactory,
    })).rejects.toMatchObject({ reason: 'dns-timeout' });
    expect(cancel).toHaveBeenCalledOnce();
  });
});
