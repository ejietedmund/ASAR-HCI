import { Fragment } from 'react';
import { SCREENS, useApp } from '../../state/appState.jsx';

const LINKS = [
  { id: SCREENS.IMPORT, label: 'Library' },
  { id: SCREENS.GOAL_PLANNER, label: 'Goal planner' },
  { id: SCREENS.SETTINGS, label: 'Settings' },
];

export default function NavBar() {
  const { screen, navigate } = useApp();

  return (
    <header className="fixed top-0 inset-x-0 h-14 bg-white border-b border-slate-200 z-40">
      <div className="h-full px-4 sm:px-6 flex items-center justify-between">
        <button
          type="button"
          onClick={() => navigate(SCREENS.IMPORT)}
          className="flex items-center gap-2.5 min-w-0"
        >
          <span className="h-7 w-7 shrink-0 rounded-lg bg-[#1e3a8a] text-white text-xs font-semibold flex items-center justify-center">
            A
          </span>
          <span className="font-semibold text-[#1a2340] truncate">Academic Reader</span>
        </button>

        <nav className="flex items-center gap-0.5 sm:gap-1 text-sm">
          {LINKS.map((link, index) => (
            <Fragment key={link.id}>
              {index > 0 && (
                <span className="text-slate-300 px-1 select-none hidden sm:inline">·</span>
              )}
              <button
                type="button"
                onClick={() => navigate(link.id)}
                className={`px-2 sm:px-3 py-1.5 rounded-lg transition-colors ${
                  screen === link.id
                    ? 'text-[#2563EB] font-semibold'
                    : 'text-slate-600 hover:text-[#1a2340] hover:bg-slate-50'
                }`}
              >
                {link.label}
              </button>
            </Fragment>
          ))}
        </nav>
      </div>
    </header>
  );
}
