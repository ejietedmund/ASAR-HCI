import { Icon, PrimaryButton, SecondaryButton } from '../shared/ui.jsx';
import { SCREENS, useApp } from '../../state/appState.jsx';

export default function HomeScreen() {
  const { navigate, activeDocument } = useApp();
  const hasDoc = Boolean(activeDocument && (activeDocument.chunks || []).length);

  const features = [
    {
      icon: 'upload',
      title: 'Import',
      body: 'Add a PDF or PowerPoint. Everything stays on this device.',
      cta: 'Go to library',
      onClick: () => navigate(SCREENS.IMPORT),
    },
    {
      icon: 'target',
      title: 'Plan',
      body: hasDoc
        ? `Set a reading goal for ${activeDocument.fileName || 'your document'}.`
        : 'Choose a reading goal that fits the time you have. Import a document first.',
      cta: hasDoc ? 'Plan a session' : 'Import to plan',
      onClick: () =>
        navigate(hasDoc ? SCREENS.GOAL_PLANNER : SCREENS.IMPORT, hasDoc ? { document: activeDocument } : {}),
    },
    {
      icon: 'book',
      title: 'Read in chunks',
      body: hasDoc
        ? `Continue where you left off in ${activeDocument.fileName || 'your document'}.`
        : 'Short, paced sections with check-ins and break reminders.',
      cta: hasDoc ? 'Continue reading' : 'Start from library',
      onClick: () =>
        navigate(hasDoc ? SCREENS.READING : SCREENS.IMPORT, hasDoc ? { document: activeDocument } : {}),
    },
  ];

  return (
    <div className="max-w-[720px] mx-auto px-4 sm:px-6 py-10 sm:py-16 anim-slide">
      <div className="bg-card border border-sep rounded-[28px] shadow-card p-7 sm:p-10 text-center">
        <span className="mx-auto w-14 h-14 rounded-2xl bg-brand text-white flex items-center justify-center shadow-[0_2px_8px_rgba(0,122,255,0.35)]">
          <Icon name="book" className="w-7 h-7" />
        </span>
        <p className="mt-4 text-[12px] font-semibold uppercase tracking-widest text-ink3">Welcome</p>
        <h1 className="mt-1 text-[30px] sm:text-[34px] font-semibold text-ink tracking-tight leading-tight">
          Focused reading for your study materials
        </h1>
        <p className="mt-3 text-[16px] text-ink2 leading-relaxed max-w-[520px] mx-auto">
          Turn lecture PDFs and slides into paced, readable chunks with realistic time estimates,
          quick check-ins, and gentle break reminders.
        </p>
        <div className="mt-7 flex flex-col sm:flex-row gap-3 justify-center">
          <PrimaryButton className="px-7 py-3.5" onClick={() => navigate(SCREENS.IMPORT)}>
            Open your library
          </PrimaryButton>
          <SecondaryButton className="px-7 py-3.5" onClick={() => navigate(SCREENS.SETTINGS)}>
            Preferences
          </SecondaryButton>
        </div>
      </div>

      <div className="mt-5 grid sm:grid-cols-3 gap-3">
        {features.map((item) => (
          <button
            key={item.title}
            type="button"
            onClick={item.onClick}
            className="group bg-card border border-sep rounded-[20px] shadow-card p-5 text-left transition-all hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(0,0,0,0.08)] hover:border-brand/30 focus:outline-none focus:ring-2 focus:ring-brand/40 active:scale-[0.99]"
          >
            <span className="w-10 h-10 rounded-xl bg-brand-soft text-brand flex items-center justify-center">
              <Icon name={item.icon} className="w-5 h-5" />
            </span>
            <h2 className="mt-3 text-[16px] font-semibold text-ink">{item.title}</h2>
            <p className="mt-1 text-[14px] text-ink2 leading-relaxed">{item.body}</p>
            <span className="mt-3 inline-flex items-center gap-1 text-[13px] font-medium text-brand">
              {item.cta}
              <Icon name="chevronRight" className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
            </span>
          </button>
        ))}
      </div>

      {hasDoc && (
        <div className="mt-4 bg-card border border-sep rounded-[20px] shadow-card p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[12px] font-semibold uppercase tracking-widest text-ink3">Recent document</p>
            <p className="text-[15px] font-medium text-ink truncate">{activeDocument.fileName}</p>
          </div>
          <div className="flex gap-2 shrink-0">
            <SecondaryButton className="px-4 py-2 text-[14px]" onClick={() => navigate(SCREENS.GOAL_PLANNER, { document: activeDocument })}>Plan</SecondaryButton>
            <PrimaryButton className="px-4 py-2 text-[14px]" onClick={() => navigate(SCREENS.READING, { document: activeDocument })}>Continue</PrimaryButton>
          </div>
        </div>
      )}
    </div>
  );
}
