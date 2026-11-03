import { useRef, useState, type KeyboardEvent } from 'react';
import { Search, X } from 'lucide-react';
import type { Opportunity } from '../types/opportunity';
import {
  searchOpportunities,
  type GlobalSearchCategory,
  type GlobalSearchResult,
} from '../utils/globalSearch';
import { ArchivedBadge } from './Badges';
import { Modal } from './Modal';

interface Props {
  items: Opportunity[];
  /** The control that opened the search, recorded for focus restoration. */
  opener?: HTMLElement | null;
  fallbackFocusId?: string;
  onClose: () => void;
  onSelect: (result: GlobalSearchResult) => void;
}

const CATEGORY_LABEL: Record<GlobalSearchCategory, string> = {
  opportunity: 'Opportunity',
  interview: 'Interview',
  contact: 'Contact',
  material: 'Material',
  activity: 'Activity',
};

const categoryClass: Record<GlobalSearchCategory, string> = {
  opportunity: 'bg-status-applied text-status-applied-text',
  interview: 'bg-status-interview text-warn',
  contact: 'bg-accent-soft text-accent-dark',
  material: 'bg-badge text-badge-text',
  activity: 'border border-border bg-table-head text-muted',
};

const badgeClass =
  'inline-block whitespace-nowrap rounded-pill px-[9px] py-[2px] text-[0.72rem] font-semibold';

function optionId(index: number): string {
  return `global-search-option-${index}`;
}

export function GlobalSearchDialog({ items, opener, fallbackFocusId = 'main-content', onClose, onSelect }: Props) {
  const [query, setQuery] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // The collection is small enough for a direct in-memory search on each
  // keystroke; no index or cache is introduced.
  const { results, total, truncated } = searchOpportunities(items, {
    query,
    includeArchived,
  });

  const trimmedQuery = query.trim();
  const lastIndex = results.length - 1;
  const selectedIndex = results.length === 0 ? -1 : Math.min(activeIndex, lastIndex);
  const selectedResult = selectedIndex >= 0 ? results[selectedIndex] : null;

  const moveSelection = (delta: number) => {
    if (results.length === 0) return;
    setActiveIndex((current) => {
      const start = Math.min(current, lastIndex);
      return Math.max(0, Math.min(start + delta, lastIndex));
    });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveSelection(1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveSelection(-1);
      return;
    }
    if (event.key === 'Enter' && selectedResult) {
      event.preventDefault();
      onSelect(selectedResult);
    }
  };

  const summary = (() => {
    if (!trimmedQuery) return 'Type to search across Launchboard.';
    if (total === 0) return 'No results.';
    if (truncated) {
      return `Showing the first ${results.length} of ${total} matches. Narrow your search to see more.`;
    }
    return `${total} ${total === 1 ? 'result' : 'results'}.`;
  })();

  return (
    <Modal
      title="Search Launchboard"
      onClose={onClose}
      opener={opener}
      fallbackFocusId={fallbackFocusId}
      initialFocusId="global-search-input"
    >
      <div className="px-s5 pt-s4 pb-s5">
        <label htmlFor="global-search-input" className="sr-only">
          Search Launchboard
        </label>
        <div className="relative text-muted">
          <Search
            size={16}
            aria-hidden
            className="absolute left-s3 top-1/2 -translate-y-1/2"
          />
          <input
            ref={inputRef}
            id="global-search-input"
            type="text"
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls="global-search-results"
            aria-autocomplete="list"
            aria-activedescendant={
              selectedResult ? optionId(selectedIndex) : undefined
            }
            aria-describedby="global-search-help"
            placeholder="Search opportunities, interviews, contacts, materials and activities"
            value={query}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleKeyDown}
            className="w-full rounded-control border border-border bg-surface py-[9px] pr-10 pl-9 text-inherit [font:inherit]"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              className="absolute right-s2 top-1/2 inline-grid h-[26px] w-[26px] -translate-y-1/2 cursor-pointer place-items-center rounded-control border-0 bg-transparent text-muted hover:bg-accent-soft hover:text-accent-dark"
              onClick={() => {
                setQuery('');
                setActiveIndex(0);
                inputRef.current?.focus();
              }}
            >
              <X size={15} aria-hidden />
            </button>
          )}
        </div>

        <div className="mt-s3 flex flex-wrap items-center justify-between gap-s2">
          <label className="inline-flex cursor-pointer items-center gap-s2 text-[0.85rem] text-text">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[var(--color-accent)]"
              checked={includeArchived}
              onChange={(event) => {
                setIncludeArchived(event.target.checked);
                setActiveIndex(0);
                // Keep the combobox usable for arrow keys after toggling.
                inputRef.current?.focus();
              }}
            />
            Include archived opportunities
          </label>
          <p id="global-search-help" className="m-0 text-[0.78rem] text-muted">
            Titles, companies, interviews, contacts, materials and activities.
          </p>
        </div>

        <div className="mt-s3 max-h-[min(52vh,420px)] overflow-y-auto">
          {!trimmedQuery ? (
            <div className="rounded-control border border-dashed border-border p-s4 text-center">
              <Search size={20} aria-hidden className="mx-auto text-muted" />
              <p className="mt-s2 mb-s1 font-semibold">Search everything in Launchboard</p>
              <p className="m-0 text-[0.85rem] text-muted">
                Find an opportunity by title or company, or look inside interview rounds,
                contacts, materials and activity notes.
              </p>
            </div>
          ) : total === 0 ? (
            <div className="rounded-control border border-dashed border-border p-s4 text-center">
              <p className="m-0 font-semibold">No matches for “{trimmedQuery}”.</p>
              <p className="mt-s1 mb-0 text-[0.85rem] text-muted">
                Try a different word
                {includeArchived ? '.' : ', or include archived opportunities.'}
              </p>
            </div>
          ) : (
            <ul
              id="global-search-results"
              role="listbox"
              aria-label="Search results"
              className="m-0 grid list-none gap-s1 p-0"
            >
              {results.map((result, index) => (
                <li
                  key={result.key}
                  id={optionId(index)}
                  role="option"
                  aria-selected={index === selectedIndex}
                  className={`cursor-pointer rounded-control border p-s3 ${
                    index === selectedIndex
                      ? 'border-accent bg-accent-soft'
                      : 'border-transparent hover:bg-table-head'
                  }`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onSelect(result)}
                >
                  <div className="flex flex-wrap items-center gap-s2">
                    <span className={`${badgeClass} ${categoryClass[result.category]}`}>
                      {CATEGORY_LABEL[result.category]}
                    </span>
                    <span className="min-w-0 font-semibold [overflow-wrap:anywhere]">
                      {result.label}
                    </span>
                    {result.archived && <ArchivedBadge />}
                  </div>
                  <p className="mt-s1 mb-0 text-[0.82rem] text-muted [overflow-wrap:anywhere]">
                    {result.context}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-s3 flex flex-wrap items-center justify-between gap-s2 border-t border-border pt-s3">
          <p
            role="status"
            aria-live="polite"
            className="m-0 text-[0.8rem] text-muted"
          >
            {summary}
          </p>
          <p className="m-0 text-[0.75rem] text-muted max-[640px]:hidden">
            ↑↓ to navigate · Enter to open · Esc to close
          </p>
        </div>
      </div>
    </Modal>
  );
}
