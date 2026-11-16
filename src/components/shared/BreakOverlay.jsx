import { useEffect, useState } from 'react';
import { Icon } from './ui.jsx';

function formatClock(seconds) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

/**
 * Full-screen, calm break timer. Used when the skimming detector or the
 * fatigue detector suggests stepping away for a few minutes.
 */
export default function BreakOverlay({ minutes = 5, onResume, onEnd, reason = 'break' }) {
  const [endsAt, setEndsAt] = useState(() => Date.now() + minutes * 60 * 1000);
  const [remaining, setRemaining] = useState(minutes * 60);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    const end = Date.now() + minutes * 60 * 1000;
    setEndsAt(end);
    setRemaining(minutes * 60);
  }, [minutes]);

  useEffect(() => {
    const tick = () => setRemaining(Math.max(0, Math.round((endsAt - Date.now()) / 1000)));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [endsAt]);

  useEffect(() => {
    if (remaining === 0 && onEnd) {
      const timer = setTimeout(onEnd, 900);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [remaining, onEnd]);

  const total = minutes * 60;
  const progress = total > 0 ? 1 - remaining / total : 0;
  const circumference = 2 * Math.PI * 86;
  const dash = circumference * progress;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/60 backdrop-blur-md anim-fade">
      <div className="w-full max-w-[380px] bg-card rounded-[32px] shadow-float p-8 text-center anim-pop">
        <div className="mx-auto w-[200px] h-[200px] relative flex items-center justify-center">
          <svg viewBox="0 0 200 200" className="absolute inset-0 -rotate-90">
            <circle cx="100" cy="100" r="86" fill="none" stroke="var(--fill)" strokeWidth="10" />
            <circle
              cx="100"
              cy="100"
              r="86"
              fill="none"
              stroke="var(--brand)"
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={`${dash} ${circumference}`}
              style={{ transition: 'stroke-dasharray 1s linear' }}
            />
          </svg>
          <div className="text-center">
            <p className="text-[13px] font-medium uppercase tracking-widest text-ink3">
              {remaining > 0 ? 'Break' : 'Ready'}
            </p>
            <p className="text-[44px] font-semibold tabular-nums text-ink leading-none mt-1">
              {formatClock(remaining)}
            </p>
          </div>
        </div>

        <h2 className="mt-4 text-[20px] font-semibold text-ink">
          {remaining > 0 ? 'Rest your eyes for a moment' : 'Break complete. Welcome back.'}
        </h2>
        <p className="mt-1.5 text-[15px] text-ink2 leading-relaxed">
          {reason === 'skim'
            ? 'Short breaks restore attention far better than pushing through.'
            : 'A few quiet minutes usually bring focus right back.'}
        </p>

        <button
          type="button"
          onClick={onResume}
          className="mt-6 w-full py-3.5 rounded-full bg-brand text-white text-[16px] font-semibold shadow-[0_2px_8px_rgba(0,122,255,0.35)] transition-all active:scale-[0.97] hover:brightness-110 flex items-center justify-center gap-2"
        >
          <Icon name="book" className="w-4.5 h-4.5" />
          {remaining > 0 ? 'Resume reading' : 'Back to reading'}
        </button>
        <button
          type="button"
          onClick={onEnd}
          className="mt-2 w-full py-3 rounded-full text-[15px] font-medium text-ink2 hover:text-ink transition-colors"
        >
          End session here
        </button>
      </div>
    </div>
  );
}
