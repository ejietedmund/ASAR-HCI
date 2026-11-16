import { Fragment } from 'react';
import { SCREENS, useApp } from '../../state/appState.jsx';
import { Icon } from './ui.jsx';

const LINKS = [
  { id: SCREENS.HOME, label: 'Home', icon: 'spark' },
  { id: SCREENS.IMPORT, label: 'Library', icon: 'book' },
  { id: SCREENS.GOAL_PLANNER, label: 'Goal', icon: 'target' },
  { id: SCREENS.SETTINGS, label: 'Settings', icon: 'gear' },
];

export default function NavBar() {
  const { screen, navigate } = useApp();

  return (
    <header className="fixed top-0 inset-x-0 h-14 bg-card/85 backdrop-blur-xl border-b border-sep z-40">
      <div className="h-full px-4 sm:px-6 flex items-center justify-between max-w-6xl mx-auto">
        <button
          type="button"
          onClick={() => navigate(SCREENS.HOME)}
          className="flex items-center gap-2.5 min-w-0"
        >
          <span className="h-8 w-8 shrink-0 rounded-[10px] bg-brand text-white flex items-center justify-center shadow-[0_2px_6px_rgba(0,122,255,0.35)]">
            <Icon name="book" className="w-4.5 h-4.5" />
          </span>
          <span className="font-semibold text-ink tracking-tight truncate">Academic Reader</span>
        </button>

        <nav className="flex items-center gap-1 text-sm">
          {LINKS.map((link, index) => (
            <Fragment key={link.id}>
              {index > 0 && <span className="text-sep px-0.5 select-none hidden sm:inline">·</span>}
              <button
                type="button"
                onClick={() => navigate(link.id)}
                className={`px-2.5 sm:px-3 py-1.5 rounded-full text-[13.5px] font-medium transition-colors ${
                  screen === link.id
                    ? 'text-brand bg-brand-soft'
                    : 'text-ink2 hover:text-ink hover:bg-fill'
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
