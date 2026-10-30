import { CalendarClock, CalendarDays, ChartColumn, LayoutDashboard, ListChecks, Rocket, Search, type LucideIcon } from 'lucide-react';
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
}

export function Sidebar({ current, onNavigate, onSearch }: Props) {
  return (
    <aside className="sticky top-0 flex h-screen flex-col gap-s5 bg-sidebar px-s4 py-s5 text-sidebar-text [&_:focus-visible]:outline-[#7fd1c9] max-[860px]:static max-[860px]:h-auto max-[860px]:flex-row max-[860px]:items-center max-[860px]:gap-s3 max-[860px]:overflow-x-auto max-[860px]:py-s3">
      <div className="flex items-center gap-s2 px-s2 text-[1.1rem] font-bold text-white">
        <Rocket size={20} aria-hidden />
        <span className="max-[640px]:hidden">Launchboard</span>
      </div>
      <button
        type="button"
        className="flex w-full cursor-pointer items-center gap-s3 rounded-control border border-white/[0.14] bg-white/[0.06] px-s3 py-2.5 text-left text-inherit [font:inherit] hover:bg-white/[0.1] max-[860px]:w-auto max-[860px]:whitespace-nowrap max-[860px]:py-2"
        aria-label="Search Launchboard"
        aria-keyshortcuts="Control+K Meta+K"
        onClick={(event) => onSearch(event.currentTarget)}
      >
        <Search size={18} aria-hidden />
        <span className="max-[640px]:hidden">Search Launchboard</span>
        <kbd className="ml-auto rounded-[4px] border border-white/20 px-[5px] py-[1px] font-sans text-[0.7rem] text-sidebar-text/80 max-[860px]:hidden">
          Ctrl K
        </kbd>
      </button>
      <nav aria-label="Main">
        <ul className="grid gap-s1 max-[860px]:flex">
          {ITEMS.map(({ view, label, icon: Icon }) => (
            <li key={view}>
              <button
                type="button"
                className={`flex w-full cursor-pointer items-center gap-s3 rounded-control border-0 bg-transparent px-s3 py-2.5 text-left text-inherit [font:inherit] max-[860px]:w-auto max-[860px]:whitespace-nowrap max-[860px]:py-2 ${
                  current === view
                    ? 'bg-white/[0.12] text-white'
                    : 'hover:bg-white/[0.07]'
                }`}
                aria-current={current === view ? 'page' : undefined}
                aria-label={label}
                onClick={() => onNavigate(view)}
              >
                <Icon size={18} aria-hidden />
                <span className="max-[640px]:hidden">{label}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <p className="mt-auto px-s2 text-xs max-[860px]:hidden">
        Data is stored in this browser only.
      </p>
    </aside>
  );
}
