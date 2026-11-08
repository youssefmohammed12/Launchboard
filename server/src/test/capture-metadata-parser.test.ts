import { describe, expect, it } from 'vitest';
import {
  CAPTURE_FIELD_LIMITS,
  parseCaptureMetadata,
} from '../services/captureMetadataParser.js';

const requestedUrl = 'https://jobs.example.com/roles/123';
const finalUrl = requestedUrl;

describe('capture metadata parser', () => {
  it('extracts title, explicit hiring organization and plain-text description from JobPosting JSON-LD', () => {
    const html = '<html><head><title>Fallback title</title>' +
      '<script type="application/ld+json">' +
      '{"@context":"https://schema.org","@type":"JobPosting",' +
      '"url":"https://jobs.example.com/roles/123","title":"Frontend Engineer",' +
      '"hiringOrganization":{"@type":"Organization","name":"Example Ltd"},' +
      '"description":"<p>Build <strong>accessible</strong> interfaces.</p>\\u003cscript\\u003eignore()\\u003c/script\\u003e<style>.x{}</style>"}' +
      '</script></head><body></body></html>';

    expect(parseCaptureMetadata(html, requestedUrl, finalUrl)).toMatchObject({
      outcome: 'ready',
      source: 'job-posting',
      title: 'Frontend Engineer',
      company: 'Example Ltd',
      description: 'Build accessible interfaces.',
    });
  });

  it('uses Open Graph, Twitter and document title/description fallbacks in order', () => {
    const html = '<html><head><title>Document title</title>' +
      '<meta property="og:title" content="Open Graph title">' +
      '<meta name="twitter:title" content="Twitter title">' +
      '<meta property="og:description" content="Open Graph description">' +
      '<meta name="description" content="Meta description">' +
      '</head><body></body></html>';

    expect(parseCaptureMetadata(html, requestedUrl, finalUrl)).toMatchObject({
      outcome: 'partial',
      source: 'page-metadata',
      title: 'Open Graph title',
      company: '',
      description: 'Open Graph description',
    });
  });

  it('sanitizes HTML fragments embedded in page-description metadata', () => {
    const html = '<html><head>' +
      '<meta property="og:title" content="Role title">' +
      '<meta property="og:description" content="&lt;div&gt;Build &lt;strong&gt;reliable&lt;/strong&gt; services.&lt;script&gt;ignore()&lt;/script&gt;&lt;/div&gt;">' +
      '</head></html>';

    expect(parseCaptureMetadata(html, requestedUrl, finalUrl)).toMatchObject({
      outcome: 'partial',
      title: 'Role title',
      description: 'Build reliable services.',
    });
  });

  it('does not infer the employer from og:site_name or publisher metadata by default', () => {
    const html = '<html><head>' +
      '<meta property="og:site_name" content="Large Job Board">' +
      '<meta property="og:title" content="Role title">' +
      '</head></html>';

    expect(parseCaptureMetadata(html, requestedUrl, finalUrl)).toMatchObject({
      title: 'Role title',
      company: '',
    });
  });

  it('allows an explicit provider opt-in to use a non-generic Open Graph site name', () => {
    const html = '<html><head>' +
      '<meta property="og:site_name" content="Fly.io">' +
      '<meta property="og:title" content="Infrastructure Ops Engineer">' +
      '</head></html>';

    expect(parseCaptureMetadata(html, requestedUrl, finalUrl, {
      allowOpenGraphSiteNameAsCompany: true,
    })).toMatchObject({
      outcome: 'ready',
      title: 'Infrastructure Ops Engineer',
      company: 'Fly.io',
    });
  });

  it('rejects generic ATS labels even when a provider opts into Open Graph site names', () => {
    const html = '<html><head>' +
      '<meta property="og:site_name" content="BambooHR">' +
      '<meta property="og:title" content="Infrastructure Ops Engineer">' +
      '</head></html>';

    expect(parseCaptureMetadata(html, requestedUrl, finalUrl, {
      allowOpenGraphSiteNameAsCompany: true,
    })).toMatchObject({
      outcome: 'partial',
      title: 'Infrastructure Ops Engineer',
      company: '',
    });
  });

  it('fails closed on malformed JSON-LD while retaining safe page metadata', () => {
    const html = '<html><head>' +
      '<script type="application/ld+json">{ invalid }</script>' +
      '<script type="application/ld+json">{"@type":"Organization","name":"Publisher"}</script>' +
      '<meta name="description" content="General page summary">' +
      '</head></html>';

    expect(parseCaptureMetadata(html, requestedUrl, finalUrl)).toMatchObject({
      outcome: 'ambiguous',
      title: '',
      company: '',
      description: 'General page summary',
    });
  });

  it('finds JobPosting nodes inside a JSON-LD graph and arrays', () => {
    const html = '<html><head><script type="application/ld+json">' +
      '[{"@type":"Organization","name":"Board"},{"@graph":[' +
      '{"@type":"JobPosting","url":"https://jobs.example.com/roles/123",' +
      '"title":"Graph role","hiringOrganization":{"name":"Hiring Co"}}]}]' +
      '</script></head></html>';

    expect(parseCaptureMetadata(html, requestedUrl, finalUrl)).toMatchObject({
      outcome: 'ready',
      title: 'Graph role',
      company: 'Hiring Co',
    });
  });

  it('selects one exact URL-matching JobPosting from a list page', () => {
    const html = '<html><head><script type="application/ld+json">' +
      '{"@graph":[' +
      '{"@type":"JobPosting","url":"https://jobs.example.com/roles/111",' +
      '"title":"Other role","hiringOrganization":{"name":"Other Co"}},' +
      '{"@type":"JobPosting","url":"https://jobs.example.com/roles/123?utm_source=mail",' +
      '"title":"Requested role","hiringOrganization":{"name":"Requested Co"}}' +
      ']}</script></head></html>';

    expect(parseCaptureMetadata(html, requestedUrl, finalUrl)).toMatchObject({
      outcome: 'ready',
      title: 'Requested role',
      company: 'Requested Co',
    });
  });

  it('returns ambiguous rather than selecting the first job when no URL uniquely matches', () => {
    const html = '<html><head><meta property="og:title" content="Search results">' +
      '<script type="application/ld+json">' +
      '{"@graph":[' +
      '{"@type":"JobPosting","url":"https://jobs.example.com/roles/111",' +
      '"title":"Role One","hiringOrganization":{"name":"One Co"}},' +
      '{"@type":"JobPosting","url":"https://jobs.example.com/roles/222",' +
      '"title":"Role Two","hiringOrganization":{"name":"Two Co"}}' +
      ']}</script></head></html>';

    expect(parseCaptureMetadata(html, requestedUrl, finalUrl)).toMatchObject({
      outcome: 'ambiguous',
      source: 'page-metadata',
      title: 'Search results',
      company: '',
      description: '',
    });
  });

  it('returns ambiguous when multiple structured postings claim the same target URL', () => {
    const html = '<html><head><script type="application/ld+json">' +
      '{"@graph":[' +
      '{"@type":"JobPosting","url":"https://jobs.example.com/roles/123","title":"One"},' +
      '{"@type":"JobPosting","url":"https://jobs.example.com/roles/123","title":"Two"}' +
      ']}</script></head></html>';

    expect(parseCaptureMetadata(html, requestedUrl, finalUrl)).toMatchObject({
      outcome: 'ambiguous',
      title: '',
      company: '',
    });
  });

  it('does not invent a company when JobPosting hiringOrganization is absent or malformed', () => {
    const html = '<html><head><script type="application/ld+json">' +
      '{"@type":"JobPosting","title":"Role","hiringOrganization":"Board Name"}' +
      '</script></head></html>';

    expect(parseCaptureMetadata(html, requestedUrl, finalUrl)).toMatchObject({
      outcome: 'partial',
      title: 'Role',
      company: '',
    });
  });

  it('bounds every field before returning it', () => {
    const longTitle = 'T'.repeat(CAPTURE_FIELD_LIMITS.title + 20);
    const longCompany = 'C'.repeat(CAPTURE_FIELD_LIMITS.company + 20);
    const longDescription = 'D'.repeat(CAPTURE_FIELD_LIMITS.description + 20);
    const html = '<script type="application/ld+json">' +
      '{"@type":"JobPosting","title":"' + longTitle +
      '","hiringOrganization":{"name":"' + longCompany +
      '"},"description":"' + longDescription + '"}' +
      '</script>';

    const result = parseCaptureMetadata(html, requestedUrl, finalUrl);
    expect(result.title).toHaveLength(CAPTURE_FIELD_LIMITS.title);
    expect(result.company).toHaveLength(CAPTURE_FIELD_LIMITS.company);
    expect(result.description).toHaveLength(CAPTURE_FIELD_LIMITS.description);
  });

  it('handles HTML entities and whitespace in metadata attributes', () => {
    const html = '<html><head>' +
      '<meta property="og:title" content="Senior &amp; Staff Engineer">' +
      '<meta name="description" content="Work&nbsp;across   teams">' +
      '</head></html>';

    expect(parseCaptureMetadata(html, requestedUrl, finalUrl)).toMatchObject({
      title: 'Senior & Staff Engineer',
      description: 'Work across teams',
    });
  });

  it('does not return script or style content from structured descriptions', () => {
    const html = '<script type="application/ld+json">' +
      '{"@type":"JobPosting","title":"Role",' +
      '"description":"Safe text\\u003cscript\\u003esteal()\\u003c/script\\u003e<style>body{}</style>"}' +
      '</script>';

    expect(parseCaptureMetadata(html, requestedUrl, finalUrl).description).toBe('Safe text');
  });

  it('fails closed on excessively deep HTML instead of recursing without bounds', () => {
    const nested = '<div>'.repeat(300) + 'nested content' + '</div>'.repeat(300);
    const html = '<html><head><meta property="og:title" content="Should be ignored"></head>' +
      '<body>' + nested + '</body></html>';

    expect(parseCaptureMetadata(html, requestedUrl, finalUrl)).toMatchObject({
      outcome: 'unsupported',
      source: 'none',
      title: '',
      company: '',
      description: '',
    });
  });

  it('finds JobPosting inside a WebPage mainEntity relationship', () => {
    const html = '<html><head><script type="application/ld+json">' +
      '{"@type":"WebPage","mainEntity":{"@type":"JobPosting",' +
      '"title":"Nested role","hiringOrganization":{"name":"Nested Co"}}}' +
      '</script></head></html>';

    expect(parseCaptureMetadata(html, requestedUrl, finalUrl)).toMatchObject({
      outcome: 'ready',
      source: 'job-posting',
      title: 'Nested role',
      company: 'Nested Co',
    });
  });

  it('fails closed when the JSON-LD block count exceeds the configured limit', () => {
    const blocks = Array.from({ length: 21 }, (_unused, index) => {
      const value = index === 0
        ? '{"@type":"JobPosting","title":"Potentially incomplete role","hiringOrganization":{"name":"Company"}}'
        : '{"@type":"Thing","name":"Metadata ' + index + '"}';
      return '<script type="application/ld+json">' + value + '</script>';
    }).join('');
    const html = '<html><head><meta property="og:title" content="Generic page">' +
      blocks + '</head></html>';

    expect(parseCaptureMetadata(html, requestedUrl, finalUrl)).toMatchObject({
      outcome: 'ambiguous',
      source: 'page-metadata',
      title: 'Generic page',
      company: '',
    });
  });

  it('fails closed when a JSON-LD block is larger than the per-block limit', () => {
    const huge = 'x'.repeat(64 * 1024 + 1);
    const html = '<html><head><meta property="og:title" content="Generic page">' +
      '<script type="application/ld+json">' + huge + '</script>' +
      '<script type="application/ld+json">' +
      '{"@type":"JobPosting","title":"Do not trust this as the only posting"}' +
      '</script></head></html>';

    expect(parseCaptureMetadata(html, requestedUrl, finalUrl)).toMatchObject({
      outcome: 'ambiguous',
      source: 'page-metadata',
      title: 'Generic page',
      company: '',
    });
  });

  it('fails closed when the JSON-LD entity traversal limit is reached', () => {
    const graph = Array.from({ length: 2050 }, (_unused, index) => (
      index === 0
        ? { '@type': 'JobPosting', title: 'Potential role', hiringOrganization: { name: 'Company' } }
        : { '@type': 'Thing' }
    ));
    const html = '<html><head><meta property="og:title" content="Generic page">' +
      '<script type="application/ld+json">' + JSON.stringify({ '@graph': graph }) +
      '</script></head></html>';

    expect(parseCaptureMetadata(html, requestedUrl, finalUrl)).toMatchObject({
      outcome: 'ambiguous',
      source: 'page-metadata',
      title: 'Generic page',
      company: '',
    });
  });

  it('returns unsupported for pages with no usable metadata', () => {
    expect(parseCaptureMetadata('<html><body><p>Nothing structured</p></body></html>', requestedUrl, finalUrl))
      .toMatchObject({
        outcome: 'unsupported',
        source: 'none',
        title: '',
        company: '',
        description: '',
      });
  });

  it('uses structured title and description before page metadata', () => {
    const html = '<html><head>' +
      '<meta property="og:title" content="Generic OG title">' +
      '<meta property="og:description" content="Generic OG description">' +
      '<script type="application/ld+json">' +
      '{"@type":"JobPosting","title":"Structured role","description":"Structured summary"}' +
      '</script></head></html>';

    expect(parseCaptureMetadata(html, requestedUrl, finalUrl)).toMatchObject({
      title: 'Structured role',
      company: '',
      description: 'Structured summary',
      source: 'job-posting',
    });
  });

  it('parses Lever-style JobPosting data with a large inline HTML document', () => {
    const structured = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'JobPosting',
      title: 'Backend Software Engineer',
      hiringOrganization: { '@type': 'Organization', name: 'SOUM' },
      description: '<p>Build reliable backend systems and APIs.</p>',
    });
    const html = '<html><head>' +
      '<title>SOUM - Backend Software Engineer</title>' +
      '<meta property="og:title" content="SOUM - Backend Software Engineer">' +
      '<script type="application/ld+json">' + structured + '</script>' +
      '</head><body><script>/* ' + 'x'.repeat(700 * 1024) + ' */</script></body></html>';

    expect(parseCaptureMetadata(html, requestedUrl, finalUrl)).toMatchObject({
      outcome: 'ready',
      source: 'job-posting',
      title: 'Backend Software Engineer',
      company: 'SOUM',
      description: 'Build reliable backend systems and APIs.',
    });
  });

  it('extracts Workday job descriptions from the explicit automation marker', () => {
    const html = '<html><head><meta property="og:title" content="Senior Software Engineer"></head>' +
      '<body><main><div data-automation-id="jobPostingDescription">' +
      '<p>Own critical services and improve platform reliability.</p>' +
      '<ul><li>Design APIs</li><li>Review production systems</li></ul>' +
      '</div><button>Apply</button></main></body></html>';

    expect(parseCaptureMetadata(html, requestedUrl, finalUrl)).toMatchObject({
      outcome: 'partial',
      source: 'page-metadata',
      title: 'Senior Software Engineer',
      company: '',
      description: 'Own critical services and improve platform reliability. Design APIs Review production systems',
    });
  });

  it('supports exact test-id, test, and QA job-description markers', () => {
    const cases = [
      'data-testid="job-description"',
      'data-test="jobDescriptionContent"',
      'data-qa="job-description-text"',
    ];

    for (const marker of cases) {
      const html = '<html><head><meta property="og:title" content="Product Designer"></head>' +
        '<body><section ' + marker + '><p>Design useful products with a cross-functional team.</p>' +
        '</section></body></html>';

      expect(parseCaptureMetadata(html, requestedUrl, finalUrl).description).toBe(
        'Design useful products with a cross-functional team.',
      );
    }
  });

  it('supports explicit job-description IDs and class names without matching generic description classes', () => {
    const html = '<html><head><meta property="og:title" content="Platform Engineer"></head>' +
      '<body><div class="description">Sidebar summary that is not the full role.</div>' +
      '<section id="jobDescription"><p>Build resilient systems and mentor engineers.</p></section>' +
      '</body></html>';

    expect(parseCaptureMetadata(html, requestedUrl, finalUrl).description).toBe(
      'Build resilient systems and mentor engineers.',
    );
  });

  it('prefers the purpose-built semantic marker over a lower-priority styling class', () => {
    const html = '<html><head><meta property="og:title" content="Backend Engineer"></head>' +
      '<body><div class="job-description">Styling wrapper text should not win.</div>' +
      '<div data-testid="job-description"><p>Build and maintain backend services.</p></div>' +
      '</body></html>';

    expect(parseCaptureMetadata(html, requestedUrl, finalUrl).description).toBe(
      'Build and maintain backend services.',
    );
  });

  it('does not combine multiple peer job-description regions', () => {
    const html = '<html><head><meta property="og:title" content="Engineering jobs"></head>' +
      '<body><article data-testid="job-description">First listing description.</article>' +
      '<article data-testid="job-description">Second listing description.</article>' +
      '</body></html>';

    expect(parseCaptureMetadata(html, requestedUrl, finalUrl)).toMatchObject({
      outcome: 'partial',
      title: 'Engineering jobs',
      company: '',
      description: '',
    });
  });

  it('does not scrape broad page containers or generic description classes', () => {
    const html = '<html><head><meta property="og:title" content="Careers"></head>' +
      '<body><main class="job-content"><article>Navigation Role summary Apply</article></main>' +
      '<div class="description">Generic marketing copy.</div></body></html>';

    expect(parseCaptureMetadata(html, requestedUrl, finalUrl)).toMatchObject({
      outcome: 'partial',
      title: 'Careers',
      description: '',
    });
  });

  it('fails closed when semantic description markers exceed the candidate limit', () => {
    const regions = Array.from({ length: 33 }, (_unused, index) =>
      '<section data-testid="job-description">Description ' + index + '</section>',
    ).join('');
    const html = '<html><head><meta property="og:title" content="Careers"></head>' +
      '<body>' + regions + '</body></html>';

    expect(parseCaptureMetadata(html, requestedUrl, finalUrl)).toMatchObject({
      outcome: 'partial',
      title: 'Careers',
      company: '',
      description: '',
    });
  });

  it('keeps semantic description text within the existing 5,000-character field limit', () => {
    const longDescription = 'x'.repeat(5_500);
    const html = '<html><head><meta property="og:title" content="Engineer"></head>' +
      '<body><div class="job-description-content">' + longDescription + '</div></body></html>';

    expect(parseCaptureMetadata(html, requestedUrl, finalUrl).description).toHaveLength(
      CAPTURE_FIELD_LIMITS.description,
    );
  });

  it('extracts Greenhouse-style job description and employer from its job page structure', () => {
    const html = '<html><head>' +
      '<title>Job Application for Graduate Software Engineer at Canonical</title>' +
      '<meta property="og:title" content="Graduate Software Engineer, Open Source and Linux">' +
      '<meta property="og:description" content="Home based - Worldwide">' +
      '</head><body><main class="main font-secondary job-post">' +
      '<div class="job__description body"><p>Canonical is hiring graduate software engineers.</p>' +
      '<p>Build open source software with engineering teams.</p></div>' +
      '</main></body></html>';

    expect(parseCaptureMetadata(html, requestedUrl, finalUrl)).toMatchObject({
      outcome: 'ready',
      source: 'page-metadata',
      title: 'Graduate Software Engineer, Open Source and Linux',
      company: 'Canonical',
      description: 'Canonical is hiring graduate software engineers. Build open source software with engineering teams.',
    });
  });

  it('uses metadata fallback when a single structured posting has no usable fields', () => {
    const html = '<html><head><meta property="og:title" content="Generic title">' +
      '<script type="application/ld+json">{"@type":"JobPosting"}</script>' +
      '</head></html>';

    expect(parseCaptureMetadata(html, requestedUrl, finalUrl)).toMatchObject({
      outcome: 'partial',
      source: 'page-metadata',
      title: 'Generic title',
      company: '',
    });
  });

  it('does not infer Personio employer from the Jobs at title suffix without provider opt-in', () => {
    const html = '<html><head>' +
      '<meta property="og:title" content="Senior Engineer | Jobs at Chrono24">' +
      '</head><body></body></html>';

    expect(parseCaptureMetadata(
      html,
      'https://chrono24.jobs.personio.de/job/2827202',
      'https://chrono24.jobs.personio.de/job/2827202',
    )).toMatchObject({
      outcome: 'partial',
      title: 'Senior Engineer | Jobs at Chrono24',
      company: '',
    });
  });

  it('extracts Personio role and employer only when the exact provider parser is enabled', () => {
    const html = '<html><head>' +
      '<meta property="og:title" content="Senior Engineer | Jobs at Chrono24">' +
      '</head><body></body></html>';

    expect(parseCaptureMetadata(
      html,
      'https://chrono24.jobs.personio.de/job/2827202',
      'https://chrono24.jobs.personio.de/job/2827202',
      { allowPersonioOpenGraphTitleAsCompany: true },
    )).toMatchObject({
      outcome: 'ready',
      title: 'Senior Engineer',
      company: 'Chrono24',
    });
  });

  it('extracts and combines Personio detail-block-description sections', () => {
    const html = '<html><head><meta property="og:title" content="Engineer"></head><body>' +
      '<div class="page_jobDescriptionItem jb-description-item">' +
      '<h2>About</h2><div class="rich-text-content detail-block-description">' +
      '<p>Build reliable services.</p></div></div>' +
      '<div class="page_jobDescriptionItem jb-description-item">' +
      '<h2>What you will do</h2><div class="rich-text-content detail-block-description">' +
      '<ul><li>Ship safe APIs</li><li>Work with product teams</li></ul>' +
      '</div></div></body></html>';

    expect(parseCaptureMetadata(html, requestedUrl, finalUrl)).toMatchObject({
      title: 'Engineer',
      description: 'Build reliable services. Ship safe APIs Work with product teams',
    });
  });

  it('extracts a Schema.org JobPosting Microdata item and nested hiring organization', () => {
    const html = '<html><body>' +
      '<main itemscope itemtype="https://schema.org/JobPosting">' +
      '<a itemprop="url" href="/roles/123?utm_source=jobs">Open role</a>' +
      '<h1 itemprop="title">Backend Engineer</h1>' +
      '<div itemprop="hiringOrganization" itemscope itemtype="https://schema.org/Organization">' +
      '<meta itemprop="name" content="Example Corporation">' +
      '</div>' +
      '<div itemprop="description"><p>Build resilient backend services.</p></div>' +
      '</main></body></html>';

    expect(parseCaptureMetadata(html, requestedUrl, finalUrl)).toMatchObject({
      outcome: 'ready',
      source: 'job-posting',
      title: 'Backend Engineer',
      company: 'Example Corporation',
      description: 'Build resilient backend services.',
    });
  });

  it('prefers JSON-LD when the same posting is also duplicated as Microdata', () => {
    const html = '<html><head><script type="application/ld+json">' +
      '{"@context":"https://schema.org","@type":"JobPosting","url":"/roles/123",' +
      '"title":"JSON-LD role","hiringOrganization":{"@type":"Organization","name":"JSON-LD Co"},' +
      '"description":"JSON-LD description"}' +
      '</script></head><body>' +
      '<article itemscope itemtype="https://schema.org/JobPosting">' +
      '<meta itemprop="url" content="/roles/123">' +
      '<h1 itemprop="title">Microdata duplicate</h1>' +
      '<div itemprop="hiringOrganization" itemscope itemtype="https://schema.org/Organization">' +
      '<span itemprop="name">Microdata Co</span></div>' +
      '</article></body></html>';

    expect(parseCaptureMetadata(html, requestedUrl, finalUrl)).toMatchObject({
      outcome: 'ready',
      source: 'job-posting',
      title: 'JSON-LD role',
      company: 'JSON-LD Co',
      description: 'JSON-LD description',
    });
  });

  it('reads Microdata properties referenced outside the posting subtree', () => {
    const html = '<html><body>' +
      '<main itemscope itemtype="http://schema.org/JobPosting" itemref="job-fields">' +
      '<link itemprop="url" href="/roles/123">' +
      '</main>' +
      '<section id="job-fields">' +
      '<meta itemprop="title" content="Data Engineer">' +
      '<div itemprop="hiringOrganization" itemscope itemtype="http://schema.org/Organization">' +
      '<meta itemprop="name" content="Acme Data">' +
      '</div>' +
      '<meta itemprop="description" content="Build data pipelines and reliable analytics.">' +
      '</section></body></html>';

    expect(parseCaptureMetadata(html, requestedUrl, finalUrl)).toMatchObject({
      outcome: 'ready',
      source: 'job-posting',
      title: 'Data Engineer',
      company: 'Acme Data',
      description: 'Build data pipelines and reliable analytics.',
    });
  });

  it('selects one exact URL-matching Microdata JobPosting when a page contains multiple jobs', () => {
    const html = '<html><body><main>' +
      '<article itemscope itemtype="https://schema.org/JobPosting">' +
      '<a itemprop="url" href="/roles/111">Other role</a>' +
      '<h2 itemprop="title">Other role</h2>' +
      '<div itemprop="hiringOrganization" itemscope itemtype="https://schema.org/Organization">' +
      '<span itemprop="name">Other Corp</span></div>' +
      '</article>' +
      '<article itemscope itemtype="https://schema.org/JobPosting">' +
      '<a itemprop="url" href="/roles/123">Requested role</a>' +
      '<h2 itemprop="title">Platform Engineer</h2>' +
      '<div itemprop="hiringOrganization" itemscope itemtype="https://schema.org/Organization">' +
      '<span itemprop="name">Requested Corp</span></div>' +
      '</article></main></body></html>';

    expect(parseCaptureMetadata(html, requestedUrl, finalUrl)).toMatchObject({
      outcome: 'ready',
      source: 'job-posting',
      title: 'Platform Engineer',
      company: 'Requested Corp',
    });
  });

  it('returns ambiguous rather than guessing between Microdata postings without one exact URL match', () => {
    const html = '<html><head><meta property="og:title" content="Engineering careers"></head>' +
      '<body><main>' +
      '<article itemscope itemtype="https://schema.org/JobPosting">' +
      '<a itemprop="url" href="/roles/111">Role one</a><h2 itemprop="title">Role One</h2></article>' +
      '<article itemscope itemtype="https://schema.org/JobPosting">' +
      '<a itemprop="url" href="/roles/222">Role two</a><h2 itemprop="title">Role Two</h2></article>' +
      '</main></body></html>';

    expect(parseCaptureMetadata(html, requestedUrl, finalUrl)).toMatchObject({
      outcome: 'ambiguous',
      source: 'page-metadata',
      title: 'Engineering careers',
      company: '',
      description: '',
    });
  });

  it('does not trust a JobPosting type hosted on a non-Schema.org vocabulary', () => {
    const html = '<html><head><meta property="og:title" content="Careers at Example"></head>' +
      '<body><article itemscope itemtype="https://attacker.example/JobPosting">' +
      '<h1 itemprop="title">Injected role</h1>' +
      '<span itemprop="hiringOrganization" itemscope itemtype="https://schema.org/Organization">' +
      '<span itemprop="name">Injected employer</span></span>' +
      '</article></body></html>';

    expect(parseCaptureMetadata(html, requestedUrl, finalUrl)).toMatchObject({
      outcome: 'partial',
      source: 'page-metadata',
      title: 'Careers at Example',
      company: '',
    });
  });

  it('fails closed when the number of Microdata JobPosting items exceeds its limit', () => {
    const postings = Array.from({ length: 101 }, (_unused, index) =>
      '<article itemscope itemtype="https://schema.org/JobPosting">' +
      '<h2 itemprop="title">Role ' + index + '</h2></article>',
    ).join('');
    const html = '<html><head><meta property="og:title" content="Careers"></head>' +
      '<body>' + postings + '</body></html>';

    expect(parseCaptureMetadata(html, requestedUrl, finalUrl)).toMatchObject({
      outcome: 'ambiguous',
      source: 'page-metadata',
      title: 'Careers',
      company: '',
    });
  });
});
