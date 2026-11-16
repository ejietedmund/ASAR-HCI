import { useEffect } from 'react';

/* ------------------------------------------------------------------ Modal */

export function Modal({ children, onClose, labelled = false }) {
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape' && onClose) onClose();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/45 backdrop-blur-[2px] anim-fade"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && onClose) onClose();
      }}
      role={labelled ? 'dialog' : undefined}
      aria-modal={labelled ? 'true' : undefined}
    >
      <div className="w-full sm:max-w-[560px] bg-card rounded-t-[28px] sm:rounded-[28px] shadow-float overflow-hidden anim-slide sm:anim-pop">
        {children}
      </div>
    </div>
  );
}

/* --------------------------------------------------------- iOS alert body */

export function AlertBody({ badge, badgeClass, title, children }) {
  return (
    <div className="px-6 pt-6 pb-2 text-center">
      {badge && (
        <span
          className={`inline-block text-[11px] font-semibold uppercase tracking-wider px-3 py-1 rounded-full ${badgeClass || 'bg-brand-soft text-brand'}`}
        >
          {badge}
        </span>
      )}
      <h2 className="mt-3 text-[20px] font-semibold text-ink leading-snug">{title}</h2>
      {children && <div className="mt-1.5 text-[15px] text-ink2 leading-relaxed">{children}</div>}
    </div>
  );
}

export function AlertActions({ actions }) {
  return (
    <div className="mt-4 border-t border-sep divide-y divide-sep">
      {actions.map((action) => (
        <button
          key={action.label}
          type="button"
          onClick={action.onClick}
          className={`w-full px-6 py-3.5 text-[17px] font-medium transition-colors active:bg-fill ${
            action.tone === 'danger'
              ? 'text-red'
              : action.primary
                ? 'text-brand'
                : 'text-ink'
          } ${action.className || ''}`}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}

/* -------------------------------------------------------- Segmented control */

export function Segmented({ options, value, onChange, ariaLabel, ...rest }) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      {...rest}
      className="relative flex gap-1 bg-fill rounded-[12px] p-1"
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={`relative flex-1 px-3 py-2 rounded-[9px] text-[13px] font-medium transition-all duration-200 ${
              selected
                ? 'bg-card text-ink shadow-[0_1px_3px_rgba(0,0,0,0.12),0_1px_2px_rgba(0,0,0,0.08)]'
                : 'text-ink2 hover:text-ink'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/* ----------------------------------------------------------------- Buttons */

export function PrimaryButton({ children, className = '', ...props }) {
  return (
    <button
      type="button"
      {...props}
      className={`px-6 py-3 rounded-full bg-brand text-white text-[15px] font-semibold shadow-[0_2px_8px_rgba(0,122,255,0.35)] transition-all active:scale-[0.97] active:bg-brand-pressed hover:brightness-110 disabled:opacity-40 disabled:shadow-none disabled:cursor-not-allowed ${className}`}
    >
      {children}
    </button>
  );
}

export function SecondaryButton({ children, className = '', ...props }) {
  return (
    <button
      type="button"
      {...props}
      className={`px-6 py-3 rounded-full bg-fill text-ink text-[15px] font-medium transition-all active:scale-[0.97] hover:bg-fill-strong disabled:opacity-40 disabled:cursor-not-allowed ${className}`}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------- Icons */

export function Icon({ name, className = 'w-5 h-5' }) {
  const paths = {
    clock: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7.5V12l3 2" />
      </>
    ),
    book: (
      <>
        <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z" />
        <path d="M4 20.5V5.5" />
        <path d="M20 18v3H6.5A2.5 2.5 0 0 1 4 18.5" />
      </>
    ),
    target: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <circle cx="12" cy="12" r="4.5" />
        <circle cx="12" cy="12" r="0.5" />
      </>
    ),
    gear: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </>
    ),
    upload: (
      <>
        <path d="M12 16V4" />
        <path d="m6 10 6-6 6 6" />
        <path d="M4 20h16" />
      </>
    ),
    chevronLeft: <path d="m14 6-6 6 6 6" />,
    chevronRight: <path d="m10 6 6 6-6 6" />,
    check: <path d="m4.5 12.5 5 5 10-11" />,
    flag: (
      <>
        <path d="M5 21V4" />
        <path d="M5 4h13l-2.5 4L18 12H5" />
      </>
    ),
    spark: (
      <>
        <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" />
      </>
    ),
    coffee: (
      <>
        <path d="M17 8h1a4 4 0 1 1 0 8h-1" />
        <path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z" />
        <path d="M6 2v2M10 2v2M14 2v2" />
      </>
    ),
    alert: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v4.5" />
        <circle cx="12" cy="16" r="0.5" />
      </>
    ),
    trash: (
      <>
        <path d="M4 7h16" />
        <path d="M9 7V5.2A1.2 1.2 0 0 1 10.2 4h3.6A1.2 1.2 0 0 1 15 5.2V7" />
        <path d="M6.5 7 7.4 19a2 2 0 0 0 2 1.8h5.2a2 2 0 0 0 2-1.8L17.5 7" />
        <path d="M10 11v6M14 11v6" />
      </>
    ),
    arrowRight: (
      <>
        <path d="M5 12h14" />
        <path d="m13 6 6 6-6 6" />
      </>
    ),
  };

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
