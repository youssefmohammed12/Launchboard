import {
  EMPTY_CAPTURE_STRUCTURED_FIELDS,
  normalizeUrlForDuplicateComparison,
  type CaptureFieldEvidenceMap,
  type CaptureFieldSource,
  type CaptureStructuredFields,
} from '@launchboard/domain';
import { parse, parseFragment, type DefaultTreeAdapterTypes } from 'parse5';
import { extractStructuredJobPostingFields } from './captureStructuredFields.js';

const MAX_JSON_LD_BLOCKS = 20;
const MAX_JSON_LD_BLOCK_LENGTH = 64 * 1024;
const MAX_JSON_LD_NODES = 2048;
const MAX_JSON_LD_DEPTH = 20;
const MAX_HTML_TREE_NODES = 30_000;
const MAX_HTML_TREE_DEPTH = 256;
const MAX_TEXT_EXTRACTION_LENGTH = 64 * 1024;

export const CAPTURE_FIELD_LIMITS = {
  title: 240,
  company: 160,
  description: 5000,
} as const;

export type CaptureMetadataOutcome = 'ready' | 'partial' | 'ambiguous' | 'unsupported';
export type CaptureMetadataSource = 'job-posting' | 'page-metadata' | 'none';

export interface CaptureMetadata extends CaptureStructuredFields {
  outcome: CaptureMetadataOutcome;
  source: CaptureMetadataSource;
  title: string;
  company: string;
  description: string;
  compensation: string;
  fieldEvidence: CaptureFieldEvidenceMap;
}

function captureMetadataResult(
  values: {
    outcome: CaptureMetadataOutcome;
    source: CaptureMetadataSource;
    title: string;
    company: string;
    description: string;
    compensation?: string;
    structuredFields?: Partial<CaptureStructuredFields>;
    fieldEvidence?: CaptureFieldEvidenceMap;
  },
): CaptureMetadata {
  return {
    ...EMPTY_CAPTURE_STRUCTURED_FIELDS,
    ...values.structuredFields,
    outcome: values.outcome,
    source: values.source,
    title: values.title,
    company: values.company,
    description: values.description,
    compensation: values.compensation ?? '',
    fieldEvidence: values.fieldEvidence ?? {},
  };
}

type HtmlNode = DefaultTreeAdapterTypes.Node;
type HtmlElement = DefaultTreeAdapterTypes.Element;

interface JobPostingNode {
  [key: string]: unknown;
  url?: unknown;
  title?: unknown;
  description?: unknown;
  hiringOrganization?: unknown;
  jobLocation?: unknown;
  jobLocationType?: unknown;
  employmentType?: unknown;
  department?: unknown;
  team?: unknown;
  datePosted?: unknown;
  baseSalary?: unknown;
}

function isElement(node: HtmlNode): node is HtmlElement {
  return 'tagName' in node && 'attrs' in node && Array.isArray(node.attrs);
}

function childNodes(node: HtmlNode): HtmlNode[] {
  if ('childNodes' in node && Array.isArray(node.childNodes)) {
    return node.childNodes as HtmlNode[];
  }
  return [];
}

function attribute(element: HtmlElement, name: string): string | undefined {
  return element.attrs.find((entry) => entry.name.toLowerCase() === name)?.value;
}

function cleanText(value: string, maxLength: number): string {
  return value
    .replace(/\u0000/gu, '')
    .replace(/\u00a0/gu, ' ')
    .replace(/\s+/gu, ' ')
    .replace(/\s+([,.;:!?])/gu, '$1')
    .trim()
    .slice(0, maxLength);
}

function collectTextContent(
  root: HtmlNode,
  options: { skipUnsafeElements: boolean },
): string | null {
  const stack: Array<{ node: HtmlNode; depth: number }> = [{ node: root, depth: 0 }];
  const chunks: string[] = [];
  let visited = 0;
  let totalLength = 0;

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    visited += 1;
    if (
      visited > MAX_HTML_TREE_NODES ||
      current.depth > MAX_HTML_TREE_DEPTH
    ) return null;

    const { node, depth } = current;
    if (
      options.skipUnsafeElements &&
      isElement(node) &&
      ['script', 'style', 'noscript', 'template'].includes(node.tagName)
    ) continue;

    if ('value' in node && typeof node.value === 'string') {
      totalLength += node.value.length;
      if (totalLength > MAX_TEXT_EXTRACTION_LENGTH) return null;
      chunks.push(node.value);
      continue;
    }

    const children = childNodes(node);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (child) stack.push({ node: child, depth: depth + 1 });
    }
  }

  return chunks.join(' ');
}

function rawTextContent(node: HtmlNode): string | null {
  return collectTextContent(node, { skipUnsafeElements: false });
}

function textContent(node: HtmlNode): string | null {
  return collectTextContent(node, { skipUnsafeElements: true });
}

function elementText(element: HtmlElement, maxLength: number): string {
  return cleanText(textContent(element) ?? '', maxLength);
}

function parseDescription(value: unknown): string {
  if (typeof value !== 'string') return '';
  const firstPass = cleanText(
    textContent(parseFragment(value)) ?? '',
    CAPTURE_FIELD_LIMITS.description,
  );

  // Some ATS APIs return HTML escaped inside an HTML string. Decode one
  // additional layer only when the first pass still contains tag-shaped text.
  const openingTag = firstPass.indexOf('<');
  const tagStart = openingTag >= 0 ? firstPass.charCodeAt(openingTag + 1) : -1;
  const beginsLikeTag = (
    (tagStart >= 65 && tagStart <= 90) ||
    (tagStart >= 97 && tagStart <= 122) ||
    tagStart === 47
  );
  if (!beginsLikeTag || !firstPass.includes('>')) return firstPass;

  return cleanText(
    textContent(parseFragment(firstPass)) ?? '',
    CAPTURE_FIELD_LIMITS.description,
  );
}

/** Converts untrusted job-board HTML or plain text into bounded, safe form text. */
export function sanitizeCaptureDescription(value: unknown): string {
  return parseDescription(value);
}

const MAX_MICRODATA_NODES = 4096;
const MAX_MICRODATA_DEPTH = 20;
const MAX_MICRODATA_POSTINGS = 100;
const MAX_SEMANTIC_DESCRIPTION_CANDIDATES = 32;

const JOB_DESCRIPTION_MARKERS = new Set([
  'jobdescription',
  'jobdescriptionbody',
  'jobdescriptioncontent',
  'jobdescriptionsection',
  'jobdescriptiontext',
  'jobdetailsdescription',
  'jobdetailsdescriptioncontent',
  'jobpostingdescription',
  'jobpostingdescriptioncontent',
]);

function normalizeDescriptionMarker(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/gu, '');
}

/**
 * Recognizes only explicit job-description markers. Broad containers such as
 * main, article, job-content, or generic description classes are not trusted.
 * Higher scores win so a purpose-built data attribute outranks styling classes.
 */
function semanticDescriptionPriority(element: HtmlElement): number {
  const marker = (value: string | undefined): boolean =>
    JOB_DESCRIPTION_MARKERS.has(normalizeDescriptionMarker(value ?? ''));

  if (marker(attribute(element, 'data-automation-id'))) return 120;
  if (
    marker(attribute(element, 'data-testid')) ||
    marker(attribute(element, 'data-test')) ||
    marker(attribute(element, 'data-qa'))
  ) return 110;
  if (marker(attribute(element, 'aria-label'))) return 100;
  if (marker(attribute(element, 'id'))) return 90;

  const classMarkers = (attribute(element, 'class') ?? '').split(/\s+/u);
  if (classMarkers.some((entry) => marker(entry))) return 80;
  return 0;
}

interface MicrodataTraversalState {
  visited: number;
  incomplete: boolean;
}

function isMicrodataScope(element: HtmlElement): boolean {
  return attribute(element, 'itemscope') !== undefined;
}

function microdataTypeNames(element: HtmlElement): string[] {
  const rawTypes = attribute(element, 'itemtype') ?? '';
  const names: string[] = [];

  for (const rawType of rawTypes.split(/[\t\n\f\r ]+/u).filter(Boolean)) {
    try {
      const parsed = new URL(rawType);
      const name = parsed.pathname.split('/').filter(Boolean).at(-1) ?? '';
      if (
        parsed.protocol === 'https:' || parsed.protocol === 'http:'
      ) {
        if (
          (parsed.hostname === 'schema.org' || parsed.hostname === 'www.schema.org') &&
          name
        ) names.push(name);
      }
    } catch {
      // Invalid itemtype tokens are ignored; they never create a trusted type.
    }
  }

  return names;
}

function isSchemaMicrodataType(element: HtmlElement, expected: string): boolean {
  return microdataTypeNames(element).some((name) => name.toLowerCase() === expected.toLowerCase());
}

function resolveMicrodataUrl(value: string, baseUrl: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';

  try {
    const parsed = new URL(trimmed, baseUrl);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
      ? parsed.toString()
      : '';
  } catch {
    return '';
  }
}

function microdataPrimitiveValue(element: HtmlElement, baseUrl: string): string {
  const tag = element.tagName.toLowerCase();

  if (tag === 'meta') return attribute(element, 'content') ?? '';
  if (['audio', 'embed', 'iframe', 'img', 'source', 'track', 'video'].includes(tag)) {
    return resolveMicrodataUrl(attribute(element, 'src') ?? '', baseUrl);
  }
  if (['a', 'area', 'link'].includes(tag)) {
    return resolveMicrodataUrl(attribute(element, 'href') ?? '', baseUrl);
  }
  if (tag === 'object') return resolveMicrodataUrl(attribute(element, 'data') ?? '', baseUrl);
  if (tag === 'data' || tag === 'meter') return attribute(element, 'value') ?? '';
  if (tag === 'time') return attribute(element, 'datetime') ?? elementText(element, MAX_TEXT_EXTRACTION_LENGTH);

  return textContent(element) ?? '';
}

function appendMicrodataProperty(
  target: Record<string, unknown>,
  name: string,
  value: unknown,
): void {
  if (value === '' || value === null || value === undefined) return;

  const current = target[name];
  if (current === undefined) {
    target[name] = value;
  } else if (Array.isArray(current)) {
    current.push(value);
  } else {
    target[name] = [current, value];
  }
}

function parseMicrodataItem(
  root: HtmlElement,
  baseUrl: string,
  elementsById: ReadonlyMap<string, HtmlElement>,
  state: MicrodataTraversalState,
  depth: number,
): Record<string, unknown> | null {
  if (depth > MAX_MICRODATA_DEPTH || state.incomplete) {
    state.incomplete = true;
    return null;
  }

  state.visited += 1;
  if (state.visited > MAX_MICRODATA_NODES) {
    state.incomplete = true;
    return null;
  }

  const result: Record<string, unknown> = {};
  const typeNames = microdataTypeNames(root);
  if (typeNames.length === 1) result['@type'] = typeNames[0];
  else if (typeNames.length > 1) result['@type'] = typeNames;

  const itemId = attribute(root, 'itemid');
  if (itemId) result['@id'] = resolveMicrodataUrl(itemId, baseUrl);

  const pending: Array<{ node: HtmlNode; depth: number }> = [];
  const seen = new Set<HtmlNode>([root]);
  const push = (node: HtmlNode, nodeDepth: number): void => {
    if (seen.has(node)) return;
    seen.add(node);
    pending.push({ node, depth: nodeDepth });
  };

  const children = childNodes(root);
  for (let index = children.length - 1; index >= 0; index -= 1) {
    const child = children[index];
    if (child) push(child, 1);
  }

  // itemref allows an item's properties to live outside its subtree. Resolve
  // IDs only from this already parsed document; never fetch referenced URLs.
  const itemRef = attribute(root, 'itemref') ?? '';
  const referencedElements = itemRef
    .split(/[\t\n\f\r ]+/u)
    .filter(Boolean)
    .map((id) => elementsById.get(id))
    .filter((element): element is HtmlElement => Boolean(element));
  for (let index = referencedElements.length - 1; index >= 0; index -= 1) {
    const element = referencedElements[index];
    if (element) push(element, 1);
  }

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;

    state.visited += 1;
    if (
      state.visited > MAX_MICRODATA_NODES ||
      current.depth > MAX_MICRODATA_DEPTH
    ) {
      state.incomplete = true;
      return null;
    }

    const node = current.node;
    if (!isElement(node)) {
      const descendants = childNodes(node);
      for (let index = descendants.length - 1; index >= 0; index -= 1) {
        const descendant = descendants[index];
        if (descendant) push(descendant, current.depth + 1);
      }
      continue;
    }

    const propertyNames = (attribute(node, 'itemprop') ?? '')
      .split(/[\t\n\f\r ]+/u)
      .filter(Boolean);

    if (isMicrodataScope(node)) {
      // An itemscope starts a separate item. It belongs to this item only when
      // the nested element itself declares an itemprop relationship.
      if (propertyNames.length > 0) {
        const nested = parseMicrodataItem(node, baseUrl, elementsById, state, depth + 1);
        if (!nested) {
          if (state.incomplete) return null;
        } else {
          for (const name of propertyNames) appendMicrodataProperty(result, name, nested);
        }
      }
      continue;
    }

    if (propertyNames.length > 0) {
      const value = microdataPrimitiveValue(node, baseUrl);
      for (const name of propertyNames) appendMicrodataProperty(result, name, value);
    }

    const descendants = childNodes(node);
    for (let index = descendants.length - 1; index >= 0; index -= 1) {
      const descendant = descendants[index];
      if (descendant) push(descendant, current.depth + 1);
    }
  }

  return result;
}

function findPageMetadata(html: string, baseUrl: string): {
  openGraphTitle: string;
  openGraphSiteName: string;
  twitterTitle: string;
  documentTitle: string;
  openGraphDescription: string;
  twitterDescription: string;
  metaDescription: string;
  jobBoardDescription: string;
  jsonLdBlocks: string[];
  microdataPostings: JobPostingNode[];
  resourceLimitExceeded: boolean;
  jsonLdIncomplete: boolean;
  microdataIncomplete: boolean;
} {
  const document = parse(html);
  const result = {
    openGraphTitle: '',
    openGraphSiteName: '',
    twitterTitle: '',
    documentTitle: '',
    openGraphDescription: '',
    twitterDescription: '',
    metaDescription: '',
    jobBoardDescription: '',
    personioDescriptionBlocks: [] as string[],
    personioDescriptionFallbacks: [] as string[],
    jsonLdBlocks: [] as string[],
    microdataPostings: [] as JobPostingNode[],
    resourceLimitExceeded: false,
    jsonLdIncomplete: false,
    microdataIncomplete: false,
  };

  const elementsById = new Map<string, HtmlElement>();
  const microdataRoots: HtmlElement[] = [];
  const semanticDescriptionCandidates: Array<{ element: HtmlElement; priority: number }> = [];
  let semanticDescriptionCandidatesOverflow = false;
  const stack: Array<{ node: HtmlNode; depth: number }> = [{ node: document, depth: 0 }];
  let visited = 0;

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    visited += 1;
    if (
      visited > MAX_HTML_TREE_NODES ||
      current.depth > MAX_HTML_TREE_DEPTH
    ) {
      result.resourceLimitExceeded = true;
      break;
    }

    const node = current.node;
    if (isElement(node)) {
      const nodeId = attribute(node, 'id');
      if (nodeId && !elementsById.has(nodeId)) elementsById.set(nodeId, node);
      if (isMicrodataScope(node) && isSchemaMicrodataType(node, 'JobPosting')) {
        if (microdataRoots.length >= MAX_MICRODATA_POSTINGS) {
          result.microdataIncomplete = true;
        } else {
          microdataRoots.push(node);
        }
      }

      const classNames = (attribute(node, 'class') ?? '').split(/[ \t\r\n]+/u);

      // Personio exposes several explicitly named detail sections. Keep this
      // provider-specific path separate because those sibling blocks are
      // intentionally combined into one description.
      if (classNames.includes('detail-block-description')) {
        const value = elementText(node, CAPTURE_FIELD_LIMITS.description);
        if (value) result.personioDescriptionBlocks.push(value);
      } else if (classNames.includes('jb-description-item')) {
        const value = elementText(node, CAPTURE_FIELD_LIMITS.description);
        if (value) result.personioDescriptionFallbacks.push(value);
      }

      // Other pages are accepted only when they mark one unambiguous, bounded
      // job-description element. A list of several matching nodes is not
      // concatenated because it may represent multiple jobs or duplicate cards.
      const descriptionPriority = semanticDescriptionPriority(node);
      if (descriptionPriority > 0) {
        if (semanticDescriptionCandidates.length >= MAX_SEMANTIC_DESCRIPTION_CANDIDATES) {
          semanticDescriptionCandidatesOverflow = true;
        } else {
          semanticDescriptionCandidates.push({ element: node, priority: descriptionPriority });
        }
      }

      if (node.tagName === 'meta') {
        const key = (
          attribute(node, 'property') ??
          attribute(node, 'name') ??
          ''
        ).trim().toLowerCase();
        const content = cleanText(
          attribute(node, 'content') ?? '',
          CAPTURE_FIELD_LIMITS.description,
        );

        if (key === 'og:title' && !result.openGraphTitle) {
          result.openGraphTitle = cleanText(content, CAPTURE_FIELD_LIMITS.title);
        } else if (key === 'og:site_name' && !result.openGraphSiteName) {
          result.openGraphSiteName = cleanText(content, CAPTURE_FIELD_LIMITS.company);
        } else if (key === 'twitter:title' && !result.twitterTitle) {
          result.twitterTitle = cleanText(content, CAPTURE_FIELD_LIMITS.title);
        } else if (key === 'og:description' && !result.openGraphDescription) {
          result.openGraphDescription = content;
        } else if (key === 'twitter:description' && !result.twitterDescription) {
          result.twitterDescription = content;
        } else if (key === 'description' && !result.metaDescription) {
          result.metaDescription = content;
        }
      } else if (node.tagName === 'title' && !result.documentTitle) {
        result.documentTitle = elementText(node, CAPTURE_FIELD_LIMITS.title);
      } else if (
        node.tagName === 'script' &&
        (attribute(node, 'type') ?? '').split(';', 1)[0]?.trim().toLowerCase() === 'application/ld+json'
      ) {
        if (result.jsonLdBlocks.length >= MAX_JSON_LD_BLOCKS) {
          result.jsonLdIncomplete = true;
        } else {
          const scriptText = rawTextContent(node);
          if (scriptText === null || scriptText.length > MAX_JSON_LD_BLOCK_LENGTH) {
            result.jsonLdIncomplete = true;
          } else if (scriptText.length > 0) {
            result.jsonLdBlocks.push(scriptText);
          }
        }
      }
    }

    const children = childNodes(node);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (child) stack.push({ node: child, depth: current.depth + 1 });
    }
  }

  if (!result.resourceLimitExceeded && !result.microdataIncomplete) {
    const microdataState: MicrodataTraversalState = { visited: 0, incomplete: false };
    for (const root of microdataRoots) {
      const posting = parseMicrodataItem(root, baseUrl, elementsById, microdataState, 0);
      if (microdataState.incomplete) {
        result.microdataIncomplete = true;
        result.microdataPostings = [];
        break;
      }
      if (posting) result.microdataPostings.push(posting as JobPostingNode);
    }
  }

  if (!result.jobBoardDescription) {
    const blocks = result.personioDescriptionBlocks.length > 0
      ? result.personioDescriptionBlocks
      : result.personioDescriptionFallbacks;
    if (blocks.length > 0) {
      result.jobBoardDescription = cleanText(
        blocks.join(' '),
        CAPTURE_FIELD_LIMITS.description,
      );
    }
  }

  if (
    !result.jobBoardDescription &&
    !semanticDescriptionCandidatesOverflow &&
    semanticDescriptionCandidates.length > 0
  ) {
    const highestPriority = Math.max(
      ...semanticDescriptionCandidates.map((candidate) => candidate.priority),
    );
    const bestCandidates = semanticDescriptionCandidates.filter(
      (candidate) => candidate.priority === highestPriority,
    );

    // A single best-marked node is safe to use. Multiple peer nodes remain
    // unresolved rather than combining descriptions from separate postings.
    if (bestCandidates.length === 1) {
      const candidate = bestCandidates[0];
      if (candidate) {
        result.jobBoardDescription = elementText(
          candidate.element,
          CAPTURE_FIELD_LIMITS.description,
        );
      }
    }
  }

  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJobPosting(value: Record<string, unknown>): value is JobPostingNode {
  const type = value['@type'];
  const types = Array.isArray(type) ? type : [type];
  return types.some((entry) => {
    if (typeof entry !== 'string') return false;
    const normalized = entry.trim().replace(/\/+$/u, '');
    return normalized.split(/[\/#:]/u).at(-1)?.toLowerCase() === 'jobposting';
  });
}

function collectJobPostings(blocks: readonly string[]): {
  postings: JobPostingNode[];
  incomplete: boolean;
} {
  const postings: JobPostingNode[] = [];
  let visited = 0;
  let incomplete = false;

  const walk = (value: unknown, depth: number): void => {
    if (depth > MAX_JSON_LD_DEPTH || visited >= MAX_JSON_LD_NODES) {
      incomplete = true;
      return;
    }

    if (Array.isArray(value)) {
      for (const entry of value) walk(entry, depth + 1);
      return;
    }

    if (!isRecord(value)) return;
    visited += 1;

    if (isJobPosting(value)) postings.push(value);

    // Walk nested JSON-LD entities as well as @graph/@included. This catches
    // common WebPage.mainEntity and ItemList.itemListElement structures while
    // remaining bounded by the node/depth ceilings above.
    for (const nested of Object.values(value)) {
      if (typeof nested === 'object' && nested !== null) {
        walk(nested, depth + 1);
      }
    }
  };

  for (const block of blocks) {
    try {
      walk(JSON.parse(block) as unknown, 0);
    } catch {
      // Malformed structured data makes the page incomplete: another hidden
      // JobPosting could have been truncated by the invalid block.
      incomplete = true;
    }
  }

  return { postings, incomplete };
}

function absolutePostingUrl(value: unknown, baseUrl: string): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  try {
    const url = new URL(value, baseUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return normalizeUrlForDuplicateComparison(url.toString());
  } catch {
    return null;
  }
}

function firstStructuredValue(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function structuredCompany(value: unknown): string {
  const organization = firstStructuredValue(value);
  if (!isRecord(organization)) return '';
  const name = firstStructuredValue(organization.name);
  if (typeof name !== 'string') return '';
  return cleanText(name, CAPTURE_FIELD_LIMITS.company);
}

function structuredTitle(value: unknown): string {
  const title = firstStructuredValue(value);
  return typeof title === 'string'
    ? cleanText(title, CAPTURE_FIELD_LIMITS.title)
    : '';
}

function structuredDescription(value: unknown): string {
  const values = Array.isArray(value) ? value : [value];
  const description = values
    .filter((entry): entry is string => typeof entry === 'string')
    .join(' ');
  return parseDescription(description);
}

function addFieldEvidence(
  evidence: CaptureFieldEvidenceMap,
  field: keyof CaptureFieldEvidenceMap,
  value: unknown,
  source: CaptureFieldSource,
  confidence: 'high' | 'medium' | 'low',
  label: string,
): void {
  const present = Array.isArray(value)
    ? value.length > 0
    : typeof value === 'string'
      ? value.trim().length > 0
      : value !== null && value !== undefined;
  if (!present) return;
  evidence[field] = { source, confidence, label };
}

function hasStructuredFields(fields: CaptureStructuredFields): boolean {
  return Boolean(
    fields.locations.length ||
    fields.department ||
    fields.team ||
    fields.workplaceType ||
    fields.employmentType ||
    fields.postedDate ||
    fields.compensationDetails,
  );
}

function pageEvidence(
  metadata: ReturnType<typeof findPageMetadata>,
  title: string,
  company: string,
  description: string,
  companyEvidenceLabel = 'Page title metadata',
): CaptureFieldEvidenceMap {
  const evidence: CaptureFieldEvidenceMap = {};
  if (title) addFieldEvidence(evidence, 'title', title, 'page-metadata', 'low', 'Page metadata');
  if (company) addFieldEvidence(evidence, 'company', company, 'page-metadata', 'low', companyEvidenceLabel);
  if (description) {
    const semantic = Boolean(metadata.jobBoardDescription);
    addFieldEvidence(
      evidence,
      'description',
      description,
      semantic ? 'semantic-html' : 'page-metadata',
      semantic ? 'medium' : 'low',
      semantic ? 'Job description section' : 'Page metadata',
    );
  }
  return evidence;
}

function personioTitleParts(title: string): { title: string; company: string } | null {
  const match = title.match(/^(.+?)\s+\|\s+Jobs at\s+(.+)$/iu);
  if (!match?.[1] || !match[2]) return null;
  const company = cleanText(match[2], CAPTURE_FIELD_LIMITS.company);
  if (!company || ['careers', 'current openings', 'job openings', 'jobs'].includes(company.toLowerCase())) {
    return null;
  }
  return {
    title: cleanText(match[1], CAPTURE_FIELD_LIMITS.title),
    company,
  };
}

function pageTitle(
  metadata: ReturnType<typeof findPageMetadata>,
  allowPersonioOpenGraphTitle = false,
): string {
  const title = metadata.openGraphTitle || metadata.twitterTitle || metadata.documentTitle;
  if (allowPersonioOpenGraphTitle) return personioTitleParts(title)?.title || title;
  return title;
}

function pageDescription(metadata: ReturnType<typeof findPageMetadata>): string {
  const value = metadata.jobBoardDescription ||
    metadata.openGraphDescription ||
    metadata.twitterDescription ||
    metadata.metaDescription;
  return parseDescription(value);
}

function pageCompanyFromDocumentTitle(
  metadata: ReturnType<typeof findPageMetadata>,
): string {
  // Greenhouse's server-rendered title uses this exact structure:
  // "Job Application for <role> at <employer>". Generic site-name metadata
  // remains disabled unless a provider-specific caller explicitly opts in.
  const match = metadata.documentTitle.match(/^Job Application for\s+.+\s+at\s+(.+)$/iu);
  return match?.[1]
    ? cleanText(match[1], CAPTURE_FIELD_LIMITS.company)
    : '';
}

function pageCompanyFromPersonioOpenGraphTitle(
  metadata: ReturnType<typeof findPageMetadata>,
): string {
  return personioTitleParts(metadata.openGraphTitle)?.company ?? '';
}

function pageCompanyFromOpenGraphSiteName(
  metadata: ReturnType<typeof findPageMetadata>,
): string {
  const name = cleanText(metadata.openGraphSiteName, CAPTURE_FIELD_LIMITS.company);
  const genericNames = new Set([
    'bamboohr',
    'bamboo hr',
    'careers',
    'current openings',
    'job openings',
    'jobs',
  ]);
  return genericNames.has(name.toLowerCase()) ? '' : name;
}

/**
 * Parses one bounded HTML document. It never selects the first job arbitrarily
 * from a list page: multiple JobPosting nodes require one exact URL match.
 */
export function parseCaptureMetadata(
  html: string,
  requestedUrl: string,
  finalUrl: string,
  options: {
    allowOpenGraphSiteNameAsCompany?: boolean;
    allowPersonioOpenGraphTitleAsCompany?: boolean;
  } = {},
): CaptureMetadata {
  const metadata = findPageMetadata(html, finalUrl);
  if (metadata.resourceLimitExceeded) {
    return captureMetadataResult({
      outcome: 'unsupported',
      source: 'none',
      title: '',
      company: '',
      description: '',
    });
  }

  const jsonLdResult = metadata.jsonLdIncomplete
    ? { postings: [] as JobPostingNode[], incomplete: true }
    : collectJobPostings(metadata.jsonLdBlocks);
  // Prefer JSON-LD when present so a page that duplicates the same job in
  // both formats does not become falsely ambiguous. Microdata is the fallback
  // structured source when no JSON-LD JobPosting exists.
  const useJsonLd = jsonLdResult.incomplete || jsonLdResult.postings.length > 0;
  const structuredResult = useJsonLd
    ? jsonLdResult
    : {
        postings: metadata.microdataPostings,
        incomplete: metadata.microdataIncomplete,
      };
  const structuredSource: CaptureFieldSource = useJsonLd
    ? 'job-posting-jsonld'
    : 'job-posting-microdata';
  const structuredLabel = useJsonLd ? 'Schema.org JobPosting JSON-LD' : 'Schema.org JobPosting Microdata';
  const requestedKey = normalizeUrlForDuplicateComparison(requestedUrl);
  const finalKey = normalizeUrlForDuplicateComparison(finalUrl);
  const fallbackTitle = pageTitle(
    metadata,
    options.allowPersonioOpenGraphTitleAsCompany,
  );
  const documentTitleCompany = pageCompanyFromDocumentTitle(metadata);
  const fallbackCompany = documentTitleCompany || (
    options.allowPersonioOpenGraphTitleAsCompany
      ? pageCompanyFromPersonioOpenGraphTitle(metadata)
      : ''
  ) || (
    options.allowOpenGraphSiteNameAsCompany
      ? pageCompanyFromOpenGraphSiteName(metadata)
      : ''
  );
  const fallbackDescription = pageDescription(metadata);

  let selectedPosting: JobPostingNode | null = null;
  let ambiguous = structuredResult.incomplete;

  if (!ambiguous && structuredResult.postings.length === 1) {
    selectedPosting = structuredResult.postings[0] ?? null;
  } else if (!ambiguous && structuredResult.postings.length > 1) {
    const matching = structuredResult.postings.filter((posting) => {
      const key = absolutePostingUrl(posting.url, finalUrl);
      return key !== null && (key === requestedKey || key === finalKey);
    });

    if (matching.length === 1) {
      selectedPosting = matching[0] ?? null;
    } else {
      ambiguous = true;
    }
  }

  if (ambiguous) {
    const title = fallbackTitle;
    const description = fallbackDescription;
    return captureMetadataResult({
      outcome: 'ambiguous',
      source: title || description ? 'page-metadata' : 'none',
      title,
      company: '',
      description,
      fieldEvidence: pageEvidence(metadata, title, '', description),
    });
  }

  if (selectedPosting) {
    const structuredRoleTitle = structuredTitle(selectedPosting.title);
    const structuredRoleDescription = structuredDescription(selectedPosting.description);
    const structuredCompanyName = structuredCompany(selectedPosting.hiringOrganization);
    const title = structuredRoleTitle || fallbackTitle;
    const company = structuredCompanyName || fallbackCompany;
    const description = structuredRoleDescription || fallbackDescription;
    const structuredFields = extractStructuredJobPostingFields(selectedPosting);
    const hasAnyStructuredField = hasStructuredFields(structuredFields);
    const hasStructuredMetadata = Boolean(
      structuredRoleTitle || structuredCompanyName || structuredRoleDescription || hasAnyStructuredField,
    );
    const hasMetadata = Boolean(title || company || description || hasAnyStructuredField);
    const evidence: CaptureFieldEvidenceMap = {};

    if (structuredRoleTitle) {
      addFieldEvidence(evidence, 'title', structuredRoleTitle, structuredSource, 'high', structuredLabel);
    } else if (title) {
      addFieldEvidence(evidence, 'title', title, 'page-metadata', 'low', 'Page metadata');
    }
    if (structuredCompanyName) {
      addFieldEvidence(evidence, 'company', structuredCompanyName, structuredSource, 'high', structuredLabel);
    } else if (company) {
      addFieldEvidence(
        evidence,
        'company',
        company,
        documentTitleCompany ? 'semantic-html' : 'page-metadata',
        documentTitleCompany ? 'medium' : 'low',
        documentTitleCompany
          ? 'Job page title pattern'
          : 'Page title metadata',
      );
    }
    if (structuredRoleDescription) {
      addFieldEvidence(evidence, 'description', structuredRoleDescription, structuredSource, 'high', structuredLabel);
    } else if (description) {
      const fallbackEvidence = pageEvidence(metadata, '', '', description);
      if (fallbackEvidence.description) evidence.description = fallbackEvidence.description;
    }

    for (const field of [
      'locations',
      'department',
      'team',
      'workplaceType',
      'employmentType',
      'postedDate',
      'compensationDetails',
    ] as const) {
      addFieldEvidence(
        evidence,
        field,
        structuredFields[field],
        structuredSource,
        'high',
        structuredLabel,
      );
    }

    return captureMetadataResult({
      outcome: !hasMetadata ? 'unsupported' : title && company ? 'ready' : 'partial',
      source: hasStructuredMetadata ? 'job-posting' : hasMetadata ? 'page-metadata' : 'none',
      title,
      company,
      description,
      structuredFields,
      fieldEvidence: evidence,
    });
  }

  const title = fallbackTitle;
  const company = fallbackCompany;
  const description = fallbackDescription;
  const hasMetadata = Boolean(title || company || description);

  return captureMetadataResult({
    outcome: !hasMetadata ? 'unsupported' : title && company ? 'ready' : 'partial',
    source: hasMetadata ? 'page-metadata' : 'none',
    title,
    company,
    description,
    fieldEvidence: pageEvidence(
      metadata,
      title,
      company,
      description,
    ),
  });
}
