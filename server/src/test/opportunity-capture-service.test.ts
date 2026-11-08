import { describe, expect, it, vi } from 'vitest';
import {
  previewOpportunityUrlWithDependencies,
  type CaptureJsonFetcher,
  type OpportunityCaptureDependencies,
} from '../services/opportunityCaptureService.js';

function htmlFallback(title = 'Fallback title') {
  return {
    html: '<html><head><meta property="og:title" content="' + title +
      '"></head></html>',
    finalUrl: 'https://jobs.example.com/role/123',
  };
}

function captureWith(
  fetchJson: CaptureJsonFetcher,
  overrides: Partial<OpportunityCaptureDependencies> = {},
) {
  const fetchHtml = vi.fn(async () => htmlFallback());
  return {
    fetchHtml,
    preview: (url: string) => previewOpportunityUrlWithDependencies(url, {
      fetchJson,
      fetchHtml,
      ...overrides,
    }),
  };
}

describe('ATS-native Quick Capture adapters', () => {
  it('uses the official Greenhouse Job Board API for exact job details and sanitizes double-escaped content', async () => {
    const fetchJson = vi.fn(async (url: string) => {
      expect(url).toBe(
        'https://boards-api.greenhouse.io/v1/boards/spacex/jobs/8696058002?pay_transparency=true',
      );
      return {
        id: 8696058002,
        title: 'New Graduate Engineer, Software - 26/27 (Starlink)',
        company_name: 'SpaceX',
        first_published: '2026-11-04T12:00:00Z',
        location: { name: 'Hawthorne, California' },
        departments: [{ name: 'Engineering' }],
        pay_input_ranges: [{ min_cents: 1500000, max_cents: 2000000, currency_type: 'USD' }],
        content: '&lt;div&gt;&lt;p&gt;Build &lt;strong&gt;software&lt;/strong&gt; for Starlink.&lt;/p&gt;&lt;script&gt;ignore()&lt;/script&gt;&lt;/div&gt;',
      };
    });
    const { preview, fetchHtml } = captureWith(fetchJson);

    await expect(preview(
      'https://job-boards.greenhouse.io/spacex/jobs/8696058002?gh_jid=8696058002',
    )).resolves.toMatchObject({
      outcome: 'ready',
      source: 'job-posting',
      title: 'New Graduate Engineer, Software - 26/27 (Starlink)',
      company: 'SpaceX',
      description: 'Build software for Starlink.',
      locations: ['Hawthorne, California'],
      department: 'Engineering',
      postedDate: '2026-11-04',
      compensationDetails: { minAmount: '15000', maxAmount: '20000', currency: 'USD', interval: '' },
      fieldEvidence: {
        postedDate: { source: 'provider-api', confidence: 'high', label: 'Greenhouse Job Board API' },
      },
    });
    expect(fetchJson).toHaveBeenCalledOnce();
    expect(fetchHtml).not.toHaveBeenCalled();
  });

  it('does not select a different Greenhouse posting when the API returns another ID', async () => {
    const fetchJson = vi.fn(async () => ({
      id: 9999999999,
      title: 'Different job',
      company_name: 'SpaceX',
      content: '<p>Do not use.</p>',
    }));
    const { preview, fetchHtml } = captureWith(fetchJson);

    await expect(preview(
      'https://job-boards.greenhouse.io/spacex/jobs/8696058002',
    )).resolves.toMatchObject({
      outcome: 'partial',
      source: 'page-metadata',
      title: 'Fallback title',
    });
    expect(fetchJson).toHaveBeenCalledOnce();
    expect(fetchHtml).toHaveBeenCalledOnce();
  });

  it('uses Ashby public board data and leaves the employer blank instead of inferring it', async () => {
    const fetchJson = vi.fn(async (url: string) => {
      expect(url).toBe('https://api.ashbyhq.com/posting-api/job-board/loora?includeCompensation=true');
      return {
        jobs: [
          {
            title: 'Other role',
            jobUrl: 'https://jobs.ashbyhq.com/loora/00000000-0000-0000-0000-000000000000',
            descriptionPlain: 'Wrong job',
            isListed: true,
          },
          {
            title: 'Front End Engineer',
            jobUrl: 'https://jobs.ashbyhq.com/loora/f2a31e7f-d110-48e7-a908-b7a79c0f0050',
            descriptionPlain: 'Build interfaces for our product.',
            isListed: true,
            team: 'Engineering',
            location: 'Austin, TX',
            secondaryLocations: [{ location: 'San Francisco' }],
            department: 'Product Engineering',
            workplaceType: 'Hybrid',
            employmentType: 'FullTime',
            publishedAt: '2026-11-05T14:00:00Z',
            compensation: {
              scrapeableCompensationSalarySummary: '$80K - $100K',
              compensationTiers: [{
                components: [{
                  compensationType: 'Salary',
                  interval: '1 YEAR',
                  currencyCode: 'USD',
                  minValue: 80000,
                  maxValue: 100000,
                }],
              }],
            },
          },
        ],
      };
    });
    const { fetchHtml, preview } = captureWith(fetchJson);

    await expect(preview(
      'https://jobs.ashbyhq.com/loora/f2a31e7f-d110-48e7-a908-b7a79c0f0050',
    )).resolves.toMatchObject({
      outcome: 'partial',
      source: 'job-posting',
      title: 'Front End Engineer',
      company: '',
      description: 'Build interfaces for our product.',
      locations: ['Austin, TX', 'San Francisco'],
      department: 'Product Engineering',
      team: 'Engineering',
      workplaceType: 'Hybrid',
      employmentType: 'Full-time',
      postedDate: '2026-11-05',
      compensationDetails: { minAmount: '80000', maxAmount: '100000', currency: 'USD', interval: 'year' },
      compensation: '$80K - $100K',
    });
    expect(fetchJson).toHaveBeenCalledOnce();
    expect(fetchHtml).toHaveBeenCalledOnce();
  });

  it('does not select an unlisted or merely first Ashby posting when the ID does not match', async () => {
    const fetchJson = vi.fn(async () => ({
      jobs: [
        {
          title: 'Unlisted role',
          jobUrl: 'https://jobs.ashbyhq.com/loora/f2a31e7f-d110-48e7-a908-b7a79c0f0050',
          descriptionPlain: 'Unlisted',
          isListed: false,
        },
      ],
    }));
    const { fetchHtml, preview } = captureWith(fetchJson);

    await expect(preview(
      'https://jobs.ashbyhq.com/loora/11111111-1111-4111-8111-111111111111',
    )).resolves.toMatchObject({
      outcome: 'partial',
      source: 'page-metadata',
      title: 'Fallback title',
    });
    expect(fetchHtml).toHaveBeenCalledOnce();
  });

  it('uses Workable account widget data and sanitizes the exact job description', async () => {
    const fetchJson = vi.fn(async (url: string) => {
      expect(url).toBe(
        'https://apply.workable.com/api/v1/widget/accounts/eva-pharma?details=true',
      );
      return {
        name: 'Eva Pharma',
        jobs: [
          {
            shortcode: 'OTHER12345',
            title: 'Other job',
            description: '<p>Wrong</p>',
          },
          {
            shortcode: '45F737EEE8',
            title: 'Software Engineer II (Frontend)',
            city: 'Cairo',
            state: 'Cairo',
            country: 'Egypt',
            department: 'Engineering',
            workplace_type: 'hybrid',
            employment_type: 'FullTime',
            published_on: '2026-11-06T10:00:00Z',
            description: '<p>Build <strong>web apps</strong>.</p><script>unsafe()</script><style>.x{}</style>',
          },
        ],
      };
    });
    const { fetchHtml, preview } = captureWith(fetchJson);

    await expect(preview(
      'https://apply.workable.com/eva-pharma/j/45F737EEE8',
    )).resolves.toMatchObject({
      outcome: 'ready',
      source: 'job-posting',
      title: 'Software Engineer II (Frontend)',
      company: 'Eva Pharma',
      description: 'Build web apps.',
      locations: ['Cairo, Cairo, Egypt'],
      department: 'Engineering',
      workplaceType: 'Hybrid',
      employmentType: 'Full-time',
      postedDate: '2026-11-06',
      fieldEvidence: {
        locations: { source: 'provider-api', confidence: 'medium', label: 'Workable public careers feed' },
      },
    });
    expect(fetchJson).toHaveBeenCalledOnce();
    expect(fetchHtml).not.toHaveBeenCalled();
  });

  it('does not treat a generic Workable account label as the employer', async () => {
    const fetchJson = vi.fn(async () => ({
      name: 'Company',
      jobs: [{
        shortcode: 'BB7BF2A13E',
        title: 'Junior AEC Software Engineer',
        description: '<p>Support design and engineering teams.</p>',
      }],
    }));
    const { preview, fetchHtml } = captureWith(fetchJson);

    await expect(preview(
      'https://apply.workable.com/t63/j/BB7BF2A13E/',
    )).resolves.toMatchObject({
      outcome: 'partial',
      source: 'job-posting',
      title: 'Junior AEC Software Engineer',
      company: '',
      description: 'Support design and engineering teams.',
    });
    expect(fetchJson).toHaveBeenCalledOnce();
    expect(fetchHtml).toHaveBeenCalledOnce();
  });

  it('uses the official Lever single-posting API and merges the employer from exact-page JobPosting data', async () => {
    const url =
      'https://jobs.lever.co/leverdemo/ad208490-4052-4f91-a57e-433f2d1e484b';
    const fetchJson = vi.fn(async (endpoint: string) => {
      expect(endpoint).toBe(
        'https://api.lever.co/v0/postings/leverdemo/ad208490-4052-4f91-a57e-433f2d1e484b?mode=json',
      );
      return {
        id: 'ad208490-4052-4f91-a57e-433f2d1e484b',
        hostedUrl: url,
        text: 'Customer Success Manager',
        descriptionPlain: 'API summary.',
        categories: {
          location: 'Atlanta, Georgia',
          allLocations: ['Atlanta, Georgia', 'Remote - USA'],
          commitment: 'Regular Full Time (Salary)',
          department: 'Customer Success',
          team: 'Enterprise',
        },
        workplaceType: 'hybrid',
        salaryDescriptionPlain: '$85,000 - $175,000 USD annually',
        salaryRange: {
          min: 85000,
          max: 175000,
          currency: 'USD',
          interval: 'per-year-salary',
        },
      };
    });
    const fetchHtml = vi.fn(async () => ({
      html: '<html><head><script type="application/ld+json">' +
        JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'JobPosting',
          url,
          title: 'Fallback title should not replace the API title',
          hiringOrganization: { '@type': 'Organization', name: 'Lever Demo' },
          description: 'This is the longer complete description from the exact job page.',
        }) +
        '</script></head></html>',
      finalUrl: url,
    }));

    await expect(previewOpportunityUrlWithDependencies(url, {
      fetchJson,
      fetchHtml,
    })).resolves.toMatchObject({
      outcome: 'ready',
      source: 'job-posting',
      title: 'Customer Success Manager',
      company: 'Lever Demo',
      description: 'This is the longer complete description from the exact job page.',
      locations: ['Atlanta, Georgia', 'Remote - USA'],
      department: 'Customer Success',
      team: 'Enterprise',
      workplaceType: 'Hybrid',
      compensationDetails: { minAmount: '85000', maxAmount: '175000', currency: 'USD', interval: 'year' },
      compensation: '$85,000 - $175,000 USD annually',
    });
    expect(fetchJson).toHaveBeenCalledOnce();
    expect(fetchHtml).toHaveBeenCalledOnce();
  });

  it('uses Lever EU API host and refuses mismatched IDs or hosted URLs', async () => {
    const url =
      'https://jobs.eu.lever.co/example/12345678-1234-4234-8234-123456789012';
    const fetchJson = vi.fn(async (endpoint: string) => {
      expect(endpoint).toBe(
        'https://api.eu.lever.co/v0/postings/example/12345678-1234-4234-8234-123456789012?mode=json',
      );
      return {
        id: '87654321-1234-4234-8234-123456789012',
        hostedUrl: url,
        text: 'Wrong posting',
        descriptionPlain: 'Do not use this response.',
      };
    });
    const fetchHtml = vi.fn(async () => ({
      html: '<html><head><meta property="og:title" content="EU fallback"></head></html>',
      finalUrl: url,
    }));

    await expect(previewOpportunityUrlWithDependencies(url, {
      fetchJson,
      fetchHtml,
    })).resolves.toMatchObject({
      outcome: 'partial',
      source: 'page-metadata',
      title: 'EU fallback',
      company: '',
      description: '',
    });
    expect(fetchJson).toHaveBeenCalledOnce();
    expect(fetchHtml).toHaveBeenCalledOnce();
  });

  it('uses SmartRecruiters posting detail and the explicit company name', async () => {
    const fetchJson = vi.fn(async (url: string) => {
      expect(url).toBe(
        'https://api.smartrecruiters.com/v1/companies/AristaNetworks/postings/744000150058443',
      );
      return {
        name: 'Software Engineer-Kernel/Driver',
        company: { name: 'Arista Networks' },
        jobAd: {
          sections: {
            jobDescription: {
              title: 'Job Description',
              text: '<p>Design and build <strong>network software</strong>.</p>',
            },
          },
        },
      };
    });
    const { fetchHtml, preview } = captureWith(fetchJson);

    await expect(preview(
      'https://jobs.smartrecruiters.com/AristaNetworks/744000150058443-software-engineer-kernel-driver',
    )).resolves.toMatchObject({
      outcome: 'ready',
      source: 'job-posting',
      title: 'Software Engineer-Kernel/Driver',
      company: 'Arista Networks',
      description: 'Design and build network software.',
    });
    expect(fetchJson).toHaveBeenCalledOnce();
    expect(fetchHtml).not.toHaveBeenCalled();
  });

  it('uses the Workday public CXS list and exact detail endpoint for the requested job', async () => {
    const calls: Array<{ url: string; options?: { method?: string; body?: unknown } }> = [];
    const fetchJson = vi.fn(async (
      url: string,
      options?: { method?: 'GET' | 'POST'; body?: unknown },
    ) => {
      calls.push({ url, options });
      if (calls.length === 1) {
        return {
          jobPostings: [
            {
              title: 'Software Engineer',
              externalPath: '/job/Dublin/Software-Engineer_JR100000-1',
            },
            {
              title: 'Software Engineer',
              externalPath: '/job/Galway-Flexible/Software-Engineer_JR112638-1',
            },
          ],
        };
      }
      return {
        hiringOrganization: { name: 'Genesys' },
        jobPostingInfo: {
          title: 'Software Engineer',
          jobDescription: '<p>Build <strong>reliable systems</strong>.</p>',
        },
      };
    });
    const { fetchHtml, preview } = captureWith(fetchJson);
    const url =
      'https://genesys.wd1.myworkdayjobs.com/en-US/Genesys/job/Galway-Flexible/Software-Engineer_JR112638-1';

    await expect(preview(url)).resolves.toMatchObject({
      outcome: 'ready',
      source: 'job-posting',
      title: 'Software Engineer',
      company: 'Genesys',
      description: 'Build reliable systems.',
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toBe(
      'https://genesys.wd1.myworkdayjobs.com/wday/cxs/genesys/Genesys/jobs',
    );
    expect(calls[0]?.options?.method).toBe('POST');
    expect(calls[0]?.options?.body).toEqual({
      appliedFacets: {},
      limit: 20,
      offset: 0,
      searchText: 'Software Engineer',
    });
    expect(calls[1]?.url).toBe(
      'https://genesys.wd1.myworkdayjobs.com/wday/cxs/genesys/Genesys/job/Galway-Flexible/Software-Engineer_JR112638-1',
    );
    expect(calls[1]?.options?.method ?? 'GET').toBe('GET');
    expect(fetchHtml).not.toHaveBeenCalled();
  });

  it('does not follow an untrusted or non-matching Workday externalPath', async () => {
    const fetchJson = vi.fn(async () => ({
      jobPostings: [
        {
          title: 'Attacker role',
          externalPath: 'https://attacker.example/job/steal',
        },
      ],
    }));
    const fetchHtml = vi.fn(async () => ({
      html: '<html><head><meta property="og:title" content="Safe fallback"></head></html>',
      finalUrl: 'https://genesys.wd1.myworkdayjobs.com/en-US/Genesys/job/Galway-Flexible/Software-Engineer_JR112638-1',
    }));

    const result = await previewOpportunityUrlWithDependencies(
      'https://genesys.wd1.myworkdayjobs.com/en-US/Genesys/job/Galway-Flexible/Software-Engineer_JR112638-1',
      { fetchJson, fetchHtml },
    );

    expect(result).toMatchObject({ outcome: 'partial', title: 'Safe fallback' });
    expect(fetchJson).toHaveBeenCalledOnce();
    expect(fetchHtml).toHaveBeenCalledOnce();
  });

  it('reports an expired Greenhouse link when the job URL redirects to an error landing page', async () => {
    const fetchJson = vi.fn();
    const fetchHtml = vi.fn(async () => ({
      html: '<html><head><title>Jobs at BambooHR</title>' +
        '<meta property="og:title" content="BambooHR">' +
        '<meta property="og:description" content="General careers page"></head></html>',
      finalUrl: 'https://job-boards.greenhouse.io/bamboohr17?error=true',
    }));

    await expect(previewOpportunityUrlWithDependencies(
      'https://job-boards.greenhouse.io/bamboohr17/jobs/6008526004',
      { fetchJson, fetchHtml },
    )).resolves.toMatchObject({
      outcome: 'not-found',
      source: 'none',
      title: '',
      company: '',
      description: '',
    });
    expect(fetchHtml).toHaveBeenCalledOnce();
  });

  it('keeps unknown sites on the generic safe HTML path', async () => {
    const fetchJson = vi.fn();
    const fetchHtml = vi.fn(async () => ({
      html: '<html><head><meta property="og:title" content="Frontend Engineer"></head></html>',
      finalUrl: 'https://jobs.example.com/roles/123',
    }));

    await expect(previewOpportunityUrlWithDependencies(
      'https://jobs.example.com/roles/123',
      { fetchJson, fetchHtml },
    )).resolves.toMatchObject({
      outcome: 'partial',
      source: 'page-metadata',
      title: 'Frontend Engineer',
    });
    expect(fetchJson).not.toHaveBeenCalled();
    expect(fetchHtml).toHaveBeenCalledOnce();
  });

  it('discovers Teamtailor public JSON Feed and extracts the exact JobPosting', async () => {
    const requestedUrl =
      'https://polestar.teamtailor.com/jobs/8681158-marketing-events-intern?utm_source=linkedin';
    const catalogUrl = 'https://polestar.teamtailor.com/.well-known/api-catalog';
    const feedUrl = 'https://polestar.teamtailor.com/jobs.json';
    const fetchJson = vi.fn(async (url: string) => {
      if (url === catalogUrl) {
        return {
          linkset: [{
            anchor: 'https://polestar.teamtailor.com/jobs',
            'service-desc': [{
              href: feedUrl,
              type: 'application/feed+json',
            }],
          }],
        };
      }
      if (url === feedUrl) {
        return {
          title: 'Polestar',
          home_page_url: 'https://polestar.teamtailor.com/jobs',
          feed_url: feedUrl,
          items: [
            {
              title: 'A different role',
              url: 'https://polestar.teamtailor.com/jobs/9999999-different-role',
              _jobposting: {
                '@type': 'JobPosting',
                title: 'A different role',
                hiringOrganization: { name: 'Wrong company' },
                description: '<p>Wrong description.</p>',
              },
            },
            {
              title: 'Marketing & Events Intern',
              url: 'https://polestar.teamtailor.com/jobs/8681158-marketing-events-intern',
              content_html: '<p>Feed description fallback.</p>',
              _jobposting: {
                '@context': 'https://schema.org',
                '@type': 'JobPosting',
                title: 'Marketing & Events Intern',
                hiringOrganization: {
                  '@type': 'Organization',
                  name: 'Polestar',
                },
                description: '<h4>The opportunity</h4><p>Join the Polestar Netherlands Marketing team.</p>',
              },
            },
          ],
        };
      }
      throw new Error('Unexpected Teamtailor endpoint: ' + url);
    });
    const { preview, fetchHtml } = captureWith(fetchJson);

    await expect(preview(requestedUrl)).resolves.toMatchObject({
      outcome: 'ready',
      source: 'job-posting',
      title: 'Marketing & Events Intern',
      company: 'Polestar',
      description: 'The opportunity Join the Polestar Netherlands Marketing team.',
    });
    expect(fetchJson).toHaveBeenCalledTimes(2);
    expect(fetchJson.mock.calls.map(([url]) => url)).toEqual([catalogUrl, feedUrl]);
    expect(fetchHtml).not.toHaveBeenCalled();
  });

  it('does not follow a Teamtailor catalog feed URL outside the current tenant', async () => {
    const catalogUrl = 'https://polestar.teamtailor.com/.well-known/api-catalog';
    const fetchJson = vi.fn(async (url: string) => {
      expect(url).toBe(catalogUrl);
      return {
        linkset: [{
          anchor: 'https://polestar.teamtailor.com/jobs',
          'service-desc': [{
            href: 'https://attacker.example/jobs.json',
            type: 'application/feed+json',
          }],
        }],
      };
    });
    const { preview, fetchHtml } = captureWith(fetchJson);

    await expect(preview(
      'https://polestar.teamtailor.com/jobs/8681158-marketing-events-intern',
    )).resolves.toMatchObject({
      outcome: 'partial',
      source: 'page-metadata',
      title: 'Fallback title',
      company: '',
    });
    expect(fetchJson).toHaveBeenCalledOnce();
    expect(fetchHtml).toHaveBeenCalledOnce();
  });

  it('does not select the first Teamtailor posting when its exact URL is absent', async () => {
    const catalogUrl = 'https://polestar.teamtailor.com/.well-known/api-catalog';
    const feedUrl = 'https://polestar.teamtailor.com/jobs.json';
    const fetchJson = vi.fn(async (url: string) => {
      if (url === catalogUrl) {
        return {
          linkset: [{
            anchor: 'https://polestar.teamtailor.com/jobs',
            'service-desc': [{ href: feedUrl, type: 'application/feed+json' }],
          }],
        };
      }
      return {
        title: 'Polestar',
        home_page_url: 'https://polestar.teamtailor.com/jobs',
        feed_url: feedUrl,
        items: [{
          title: 'Another role',
          url: 'https://polestar.teamtailor.com/jobs/9999999-another-role',
          _jobposting: {
            '@type': 'JobPosting',
            title: 'Another role',
            hiringOrganization: { name: 'Polestar' },
            description: '<p>Must not be used.</p>',
          },
        }],
      };
    });
    const { preview, fetchHtml } = captureWith(fetchJson);

    await expect(preview(
      'https://polestar.teamtailor.com/jobs/8681158-marketing-events-intern',
    )).resolves.toMatchObject({
      outcome: 'partial',
      source: 'page-metadata',
      title: 'Fallback title',
      company: '',
    });
    expect(fetchJson).toHaveBeenCalledTimes(2);
    expect(fetchHtml).toHaveBeenCalledOnce();
  });

  it('uses Breezy public listing data for the exact posting and merges page metadata', async () => {
    const url = 'https://breezy.breezy.hr/p/98323abf2296-employee-12?source=LinkedIn';
    const fetchJson = vi.fn(async (endpoint: string) => {
      expect(endpoint).toBe('https://breezy.breezy.hr/json');
      return [
        {
          id: 'aaaaaaaaaaaa',
          friendly_id: 'aaaaaaaaaaaa-another-job',
          name: 'Wrong job',
          url: 'https://breezy.breezy.hr/p/aaaaaaaaaaaa-another-job',
          company: { name: 'Wrong employer' },
        },
        {
          id: '98323abf2296',
          friendly_id: '98323abf2296-employee-12',
          name: 'Employee #12',
          url: 'https://breezy.breezy.hr/p/98323abf2296-employee-12',
          company: { name: 'MS Breezy Trial' },
        },
      ];
    });
    const fetchHtml = vi.fn(async () => ({
      html: '<html><head>' +
        '<meta property="og:title" content="Employee #12 at MS Breezy Trial">' +
        '<meta property="og:description" content="Roses and Rainbows until 30 days in.">' +
        '</head></html>',
      finalUrl: 'https://breezy.breezy.hr/p/98323abf2296-employee-12',
    }));

    await expect(previewOpportunityUrlWithDependencies(url, {
      fetchJson,
      fetchHtml,
    })).resolves.toMatchObject({
      outcome: 'ready',
      source: 'job-posting',
      title: 'Employee #12',
      company: 'MS Breezy Trial',
      description: 'Roses and Rainbows until 30 days in.',
    });
    expect(fetchJson).toHaveBeenCalledOnce();
    expect(fetchHtml).toHaveBeenCalledOnce();
  });

  it('does not use a different Breezy board posting as the requested job', async () => {
    const url = 'https://breezy.breezy.hr/p/98323abf2296-employee-12';
    const fetchJson = vi.fn(async () => [{
      id: 'aaaaaaaaaaaa',
      friendly_id: 'aaaaaaaaaaaa-another-job',
      name: 'Wrong job',
      url: 'https://breezy.breezy.hr/p/aaaaaaaaaaaa-another-job',
      company: { name: 'Wrong employer' },
    }]);
    const fetchHtml = vi.fn(async () => ({
      html: '<html><head><meta property="og:title" content="Fallback title"></head></html>',
      finalUrl: url,
    }));

    await expect(previewOpportunityUrlWithDependencies(url, {
      fetchJson,
      fetchHtml,
    })).resolves.toMatchObject({
      outcome: 'partial',
      source: 'page-metadata',
      title: 'Fallback title',
      company: '',
    });
    expect(fetchJson).toHaveBeenCalledOnce();
    expect(fetchHtml).toHaveBeenCalledOnce();
  });

  it('uses the BambooHR list and exact detail endpoints, then reads the tenant site name', async () => {
    const url = 'https://flyio.bamboohr.com/careers/35?source=LinkedIn';
    const listUrl = 'https://flyio.bamboohr.com/careers/list';
    const detailUrl = 'https://flyio.bamboohr.com/careers/35/detail';
    const fetchJson = vi.fn(async (endpoint: string) => {
      if (endpoint === listUrl) {
        return {
          meta: { totalCount: 10 },
          result: [
            { id: '99', jobOpeningName: 'Different job' },
            { id: '35', jobOpeningName: 'Infrastructure Ops Engineer' },
          ],
        };
      }
      if (endpoint === detailUrl) {
        return {
          meta: {},
          result: {
            jobOpening: {
              jobOpeningShareUrl: 'https://flyio.bamboohr.com/careers/35',
              jobOpeningName: 'Infrastructure Ops Engineer',
              jobOpeningStatus: 'Open',
              departmentLabel: 'Infrastructure Operations',
              description: '<p>Build reliable infrastructure services.</p>',
            },
          },
        };
      }
      throw new Error('Unexpected BambooHR endpoint: ' + endpoint);
    });
    const fetchHtml = vi.fn(async () => ({
      html: '<html><head>' +
        '<meta property="og:title" content="Infrastructure Ops Engineer">' +
        '<meta property="og:site_name" content="fly.io">' +
        '<meta property="og:description" content="Build reliable infrastructure services.">' +
        '</head></html>',
      finalUrl: 'https://flyio.bamboohr.com/careers/35',
    }));

    await expect(previewOpportunityUrlWithDependencies(url, {
      fetchJson,
      fetchHtml,
    })).resolves.toMatchObject({
      outcome: 'ready',
      source: 'job-posting',
      title: 'Infrastructure Ops Engineer',
      company: 'fly.io',
      description: 'Build reliable infrastructure services.',
    });
    expect(fetchJson.mock.calls.map(([endpoint]) => endpoint)).toEqual([listUrl, detailUrl]);
    expect(fetchHtml).toHaveBeenCalledOnce();
  });

  it('rejects a BambooHR detail response whose share URL does not match the requested posting', async () => {
    const url = 'https://flyio.bamboohr.com/careers/35';
    const fetchJson = vi.fn(async (endpoint: string) => {
      if (endpoint.endsWith('/careers/list')) {
        return { result: [{ id: '35', jobOpeningName: 'Infrastructure Ops Engineer' }] };
      }
      return {
        result: {
          jobOpening: {
            jobOpeningShareUrl: 'https://attacker.example/careers/35',
            jobOpeningName: 'Wrong role',
            jobOpeningStatus: 'Open',
            description: '<p>Wrong description.</p>',
          },
        },
      };
    });
    const fetchHtml = vi.fn(async () => ({
      html: '<html><head><meta property="og:title" content="Fallback role"></head></html>',
      finalUrl: url,
    }));

    await expect(previewOpportunityUrlWithDependencies(url, {
      fetchJson,
      fetchHtml,
    })).resolves.toMatchObject({
      outcome: 'partial',
      source: 'page-metadata',
      title: 'Fallback role',
      company: '',
      description: '',
    });
    expect(fetchJson).toHaveBeenCalledTimes(2);
    expect(fetchHtml).toHaveBeenCalledOnce();
  });

  it('does not request BambooHR detail data when the ID is absent from the public list', async () => {
    const url = 'https://flyio.bamboohr.com/careers/12345';
    const fetchJson = vi.fn(async () => ({
      result: [{ id: '35', jobOpeningName: 'Infrastructure Ops Engineer' }],
    }));
    const fetchHtml = vi.fn(async () => ({
      html: '<html><head><meta property="og:title" content="Fallback role"></head></html>',
      finalUrl: url,
    }));

    await expect(previewOpportunityUrlWithDependencies(url, {
      fetchJson,
      fetchHtml,
    })).resolves.toMatchObject({
      outcome: 'partial',
      source: 'page-metadata',
      title: 'Fallback role',
    });
    expect(fetchJson).toHaveBeenCalledOnce();
    expect(fetchHtml).toHaveBeenCalledOnce();
  });

  it('uses the exact Personio XML position and its CDATA job description', async () => {
    const url = 'https://chrono24.jobs.personio.de/job/2827202?language=en';
    const feedUrl = 'https://chrono24.jobs.personio.de/xml?language=en';
    const xml = '<?xml version="1.0" encoding="UTF-8"?>' +
      '<workzag-jobs>' +
      '<position><id>1234567</id><name>Wrong role</name><subcompany>Wrong Ltd</subcompany>' +
      '<jobDescriptions><jobDescription><name>About</name><value><![CDATA[<p>Wrong body.</p>]]></value></jobDescription></jobDescriptions></position>' +
      '<position><id>2827202</id><subcompany>Chrono24 GmbH</subcompany>' +
      '<office>Berlin, Germany</office><department>Engineering</department>' +
      '<recruitingCategory>Technology</recruitingCategory><employmentType>permanent</employmentType><schedule>full-time</schedule>' +
      '<name>(Senior) Full Stack Engineer (Backend Focus) (m/f/d)</name>' +
      '<jobDescriptions><jobDescription><name>About</name><value><![CDATA[<p>Build backend services and APIs.</p>]]></value></jobDescription>' +
      '<jobDescription><name>What you will do</name><value><![CDATA[<ul><li>Own features</li><li>Work with product teams</li></ul>]]></value></jobDescription></jobDescriptions></position>' +
      '</workzag-jobs>';
    const fetchXml = vi.fn(async (endpoint: string) => {
      expect(endpoint).toBe(feedUrl);
      return xml;
    });
    const fetchHtml = vi.fn(async () => ({
      html: '<html><head></head></html>',
      finalUrl: url,
    }));

    await expect(previewOpportunityUrlWithDependencies(url, {
      fetchJson: vi.fn(),
      fetchXml,
      fetchHtml,
    })).resolves.toMatchObject({
      outcome: 'ready',
      source: 'job-posting',
      title: '(Senior) Full Stack Engineer (Backend Focus) (m/f/d)',
      company: 'Chrono24 GmbH',
      description: 'Build backend services and APIs. Own features Work with product teams',
      locations: ['Berlin, Germany'],
      department: 'Engineering',
      team: 'Technology',
      employmentType: 'Full-time',
    });
    expect(fetchXml).toHaveBeenCalledOnce();
    expect(fetchHtml).not.toHaveBeenCalled();
  });

  it('uses Personio rendered job sections when the enabled XML feed omits descriptions', async () => {
    const url = 'https://chrono24.jobs.personio.de/job/2827202?language=xx';
    const xml = '<?xml version="1.0"?><workzag-jobs><position>' +
      '<id>2827202</id><name>Senior Engineer</name>' +
      '<jobDescriptions></jobDescriptions></position></workzag-jobs>';
    const fetchXml = vi.fn(async (endpoint: string) => {
      expect(endpoint).toBe('https://chrono24.jobs.personio.de/xml?language=en');
      return xml;
    });
    const fetchHtml = vi.fn(async () => ({
      html: '<html><head><meta property="og:title" content="Senior Engineer | Jobs at Chrono24"></head>' +
        '<body><div class="jb-description-item"><h2>About</h2>' +
        '<div class="detail-block-description"><p>Build reliable services.</p></div></div>' +
        '<div class="jb-description-item"><h2>What you will do</h2>' +
        '<div class="detail-block-description"><ul><li>Ship APIs</li></ul></div></div>' +
        '</body></html>',
      finalUrl: 'https://chrono24.jobs.personio.de/job/2827202',
    }));

    await expect(previewOpportunityUrlWithDependencies(url, {
      fetchJson: vi.fn(),
      fetchXml,
      fetchHtml,
    })).resolves.toMatchObject({
      outcome: 'ready',
      source: 'job-posting',
      title: 'Senior Engineer',
      company: 'Chrono24',
      description: 'Build reliable services. Ship APIs',
    });
    expect(fetchXml).toHaveBeenCalledOnce();
    expect(fetchHtml).toHaveBeenCalledOnce();
  });

  it('rejects a Personio XML record that belongs to another job ID', async () => {
    const url = 'https://chrono24.jobs.personio.de/job/2827202';
    const fetchXml = vi.fn(async () =>
      '<?xml version="1.0"?><workzag-jobs><position><id>2827203</id>' +
      '<name>Different role</name><subcompany>Wrong company</subcompany>' +
      '<jobDescriptions><jobDescription><value><![CDATA[Wrong content]]></value></jobDescription></jobDescriptions>' +
      '</position></workzag-jobs>',
    );
    const fetchHtml = vi.fn(async () => ({
      html: '<html><head><meta property="og:title" content="Fallback Personio job"></head></html>',
      finalUrl: url,
    }));

    await expect(previewOpportunityUrlWithDependencies(url, {
      fetchXml,
      fetchHtml,
    })).resolves.toMatchObject({
      outcome: 'partial',
      source: 'page-metadata',
      title: 'Fallback Personio job',
      company: '',
    });
    expect(fetchXml).toHaveBeenCalledOnce();
    expect(fetchHtml).toHaveBeenCalledOnce();
  });

  it('rejects Personio XML with a document type declaration and uses safe page fallback', async () => {
    const url = 'https://chrono24.jobs.personio.de/job/2827202';
    const fetchXml = vi.fn(async () =>
      '<?xml version="1.0"?><!DOCTYPE workzag-jobs [<!ENTITY x SYSTEM "file:///etc/passwd">]>' +
      '<workzag-jobs><position><id>2827202</id><name>Injected</name></position></workzag-jobs>',
    );
    const fetchHtml = vi.fn(async () => ({
      html: '<html><head><meta property="og:title" content="Fallback Personio job"></head></html>',
      finalUrl: url,
    }));

    await expect(previewOpportunityUrlWithDependencies(url, {
      fetchXml,
      fetchHtml,
    })).resolves.toMatchObject({
      outcome: 'partial',
      source: 'page-metadata',
      title: 'Fallback Personio job',
    });
    expect(fetchXml).toHaveBeenCalledOnce();
    expect(fetchHtml).toHaveBeenCalledOnce();
  });

  it('uses the exact public Rippling detail endpoint and extracts the role description', async () => {
    const postingId = '84d388b6-7656-434c-8862-0312eb6b97ac';
    const url = 'https://ats.rippling.com/de-DE/rippling/jobs/' + postingId + '?source=LinkedIn';
    const endpoint = 'https://api.rippling.com/platform/api/ats/v1/board/rippling/jobs/' + postingId;
    const fetchJson = vi.fn(async (requested: string) => {
      expect(requested).toBe(endpoint);
      return {
        uuid: postingId,
        name: 'Business Operations Manager',
        companyName: 'Rippling',
        description: {
          company: '<div><p>General company introduction that is not the role body.</p></div>',
          role: '<div><h2>About the role</h2><p>Build operational systems and solve high-impact problems.</p></div>',
        },
        url: 'https://ats.rippling.com/rippling/jobs/' + postingId,
        board: {
          slug: 'rippling',
          companyName: 'Rippling',
        },
        createdOn: '2026-03-31T17:37:26.093000-07:00',
        employmentType: { label: 'SALARIED_FT', id: 'Salaried, full-time' },
        payRangeDetails: [],
      };
    });
    const { preview, fetchHtml } = captureWith(fetchJson);

    await expect(preview(url)).resolves.toMatchObject({
      outcome: 'ready',
      source: 'job-posting',
      title: 'Business Operations Manager',
      company: 'Rippling',
      description: 'About the role Build operational systems and solve high-impact problems.',
    });
    expect(fetchJson).toHaveBeenCalledOnce();
    expect(fetchHtml).not.toHaveBeenCalled();
  });

  it('rejects a Rippling detail record with a different UUID', async () => {
    const postingId = '84d388b6-7656-434c-8862-0312eb6b97ac';
    const url = 'https://ats.rippling.com/rippling/jobs/' + postingId;
    const fetchJson = vi.fn(async () => ({
      uuid: 'eb23a6c5-2260-4fb7-b1a5-7e4d23c4417d',
      name: 'Different role',
      companyName: 'Wrong employer',
      description: { role: '<p>Wrong description.</p>' },
      url,
      board: { slug: 'rippling', companyName: 'Wrong employer' },
    }));
    const fetchHtml = vi.fn(async () => ({
      html: '<html><head><meta property="og:title" content="Fallback title"></head></html>',
      finalUrl: url,
    }));

    await expect(previewOpportunityUrlWithDependencies(url, {
      fetchJson,
      fetchHtml,
    })).resolves.toMatchObject({
      outcome: 'partial',
      source: 'page-metadata',
      title: 'Fallback title',
      company: '',
    });
    expect(fetchJson).toHaveBeenCalledOnce();
    expect(fetchHtml).toHaveBeenCalledOnce();
  });

  it('rejects Rippling detail data from a different board or canonical URL', async () => {
    const postingId = '84d388b6-7656-434c-8862-0312eb6b97ac';
    const url = 'https://ats.rippling.com/rippling/jobs/' + postingId;
    const fetchJson = vi.fn(async () => ({
      uuid: postingId,
      name: 'Wrong tenant job',
      companyName: 'Wrong employer',
      description: { role: '<p>Wrong description.</p>' },
      url: 'https://ats.rippling.com/another-board/jobs/' + postingId,
      board: { slug: 'another-board', companyName: 'Wrong employer' },
    }));
    const fetchHtml = vi.fn(async () => ({
      html: '<html><head><meta property="og:title" content="Fallback title"></head></html>',
      finalUrl: url,
    }));

    await expect(previewOpportunityUrlWithDependencies(url, {
      fetchJson,
      fetchHtml,
    })).resolves.toMatchObject({
      outcome: 'partial',
      source: 'page-metadata',
      title: 'Fallback title',
      company: '',
    });
    expect(fetchJson).toHaveBeenCalledOnce();
    expect(fetchHtml).toHaveBeenCalledOnce();
  });

  it('rejects a Rippling canonical URL with a non-standard port', async () => {
    const postingId = '84d388b6-7656-434c-8862-0312eb6b97ac';
    const url = 'https://ats.rippling.com/rippling/jobs/' + postingId;
    const fetchJson = vi.fn(async () => ({
      uuid: postingId,
      name: 'Business Operations Manager',
      companyName: 'Rippling',
      description: { role: '<p>Must not be used.</p>' },
      url: 'https://ats.rippling.com:8443/rippling/jobs/' + postingId,
      board: { slug: 'rippling', companyName: 'Rippling' },
    }));
    const fetchHtml = vi.fn(async () => ({
      html: '<html><head><meta property="og:title" content="Fallback title"></head></html>',
      finalUrl: url,
    }));

    await expect(previewOpportunityUrlWithDependencies(url, {
      fetchJson,
      fetchHtml,
    })).resolves.toMatchObject({
      outcome: 'partial',
      source: 'page-metadata',
      title: 'Fallback title',
      company: '',
    });
    expect(fetchJson).toHaveBeenCalledOnce();
    expect(fetchHtml).toHaveBeenCalledOnce();
  });

  it.each([
    'https://www.linkedin.com/jobs/view/4461086287/',
    'https://linkedin.com/jobs/search/',
    'https://uk.linkedin.com/jobs/view/123456/',
  ])('does not fetch LinkedIn content: %s', async (url) => {
    const fetchJson = vi.fn(async () => ({}));
    const fetchHtml = vi.fn(async () => ({
      html: '<html><head><meta property="og:title" content="Must not be read"></head></html>',
      finalUrl: url,
    }));

    await expect(previewOpportunityUrlWithDependencies(url, {
      fetchJson,
      fetchHtml,
    })).resolves.toMatchObject({
      outcome: 'unsupported',
      source: 'none',
      title: '',
      company: '',
      description: '',
    });

    expect(fetchJson).not.toHaveBeenCalled();
    expect(fetchHtml).not.toHaveBeenCalled();
  });
  it('uses the exact Rippling page as fallback when the detail record omits the role body', async () => {
    const postingId = '84d388b6-7656-434c-8862-0312eb6b97ac';
    const url = 'https://ats.rippling.com/rippling/jobs/' + postingId;
    const fetchJson = vi.fn(async () => ({
      uuid: postingId,
      name: 'Business Operations Manager',
      companyName: 'Rippling',
      description: { company: '<p>Company background only.</p>', role: '' },
      url,
      board: { slug: 'rippling', companyName: 'Rippling' },
    }));
    const fetchHtml = vi.fn(async () => ({
      html: '<html><head>' +
        '<meta property="og:title" content="Business Operations Manager">' +
        '<meta property="og:description" content="Build operational systems and solve high-impact problems.">' +
        '</head></html>',
      finalUrl: url,
    }));

    await expect(previewOpportunityUrlWithDependencies(url, {
      fetchJson,
      fetchHtml,
    })).resolves.toMatchObject({
      outcome: 'ready',
      source: 'job-posting',
      title: 'Business Operations Manager',
      company: 'Rippling',
      description: 'Build operational systems and solve high-impact problems.',
    });
    expect(fetchJson).toHaveBeenCalledOnce();
    expect(fetchHtml).toHaveBeenCalledOnce();
  });
});
