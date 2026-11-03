import {
  CalendarClock,
  CalendarDays,
  ChartColumn,
  LayoutDashboard,
  ListChecks,
  Rocket,
  Search,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import type { View } from '../types/opportunity';

const ITEMS: { view: View; label: string; icon: LucideIcon }[] = [
  { view: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { view: 'opportunities', label: 'Opportunities', icon: ListChecks },
  { view: 'calendar', label: 'Calendar', icon: CalendarDays },
  { view: 'deadlines', label: 'Deadlines', icon: CalendarClock },
  { view: 'reports', label: 'Reports', icon: ChartColumn },
];

interface Props {
  current: View;
  onNavigate: (view: View) => void;
  /** Opens global search; the trigger is recorded for focus restoration. */
  onSearch: (trigger?: HTMLElement | null) => void;
  storageDescription?: string;
}

export function Sidebar({
  current,
  onNavigate,
  onSearch,
  storageDescription = 'Data is stored in this browser only.',
}: Props) {
  return (
    <aside className="lb-sidebar">
      <div className="lb-sidebar-brand">
        <span className="lb-logo-mark" aria-hidden="true">
          <Rocket size={20} strokeWidth={2.2} />
        </span>
        <div>
          <span className="lb-brand-name">Launchboard</span>
          <span className="lb-brand-tag">OPPORTUNITY WORKSPACE</span>
        </div>
      </div>

      <button
        type="button"
        className="lb-search-trigger"
        aria-label="Search Launchboard"
        aria-keyshortcuts="Control+K Meta+K"
        onClick={(event) => onSearch(event.currentTarget)}
      >
        <Search size={17} aria-hidden="true" />
        <span>Search anything</span>
        <kbd>Ctrl K</kbd>
      </button>

      <nav className="lb-primary-nav" aria-label="Main">
        <span className="lb-nav-caption">WORKSPACE</span>
        <ul className="lb-nav-list">
          {ITEMS.map(({ view, label, icon: Icon }) => (
            <li key={view}>
              <button
                type="button"
                className="lb-nav-link"
                aria-current={current === view ? 'page' : undefined}
                aria-label={label}
                onClick={() => onNavigate(view)}
              >
                <Icon size={18} aria-hidden="true" />
                <span>{label}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="lb-sidebar-spacer" />
      <div className="lb-sidebar-footer">
        <span className="lb-sidebar-footer-icon" aria-hidden="true">
          <ShieldCheck size={16} />
        </span>
        <div>
          <strong>Private workspace</strong>
          <span>{storageDescription}</span>
        </div>
      </div>
    </aside>
  );
}
