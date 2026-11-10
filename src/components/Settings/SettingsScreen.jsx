import { useEffect, useState } from 'react';
import { useApp } from '../../state/appState.jsx';

const GROUPS = [
  {
    key: 'textSize',
    label: 'Text size',
    options: [
      { value: 'small', label: 'Small' },
      { value: 'medium', label: 'Medium' },
      { value: 'large', label: 'Large' },
    ],
  },
  {
    key: 'contrast',
    label: 'Contrast',
    options: [
      { value: 'standard', label: 'Standard' },
      { value: 'high', label: 'High' },
    ],
  },
  {
    key: 'checkpointFrequency',
    label: 'Checkpoint frequency',
    options: [
      { value: 3, label: 'Every 3 chunks' },
      { value: 5, label: 'Every 5 chunks' },
      { value: 8, label: 'Every 8 chunks' },
    ],
  },
];

export default function SettingsScreen() {
  const { preferences, updatePreferences } = useApp();
  const [draft, setDraft] = useState(preferences);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setDraft(preferences);
  }, [preferences]);

  useEffect(() => {
    if (!saved) return undefined;
    const timer = setTimeout(() => setSaved(false), 2000);
    return () => clearTimeout(timer);
  }, [saved]);

  const select = (key, value) => {
    setSaved(false);
    setDraft((previous) => ({ ...previous, [key]: value }));
  };

  const save = async () => {
    await updatePreferences(draft);
    setSaved(true);
  };

  return (
    <div className="max-w-[576px] mx-auto px-4 sm:px-6 py-8 sm:py-12">
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 sm:p-8">
        <h1 className="text-2xl font-semibold text-[#1a2340]">Settings</h1>

        {GROUPS.map((group) => (
          <div key={group.key} className="mt-6">
            <p className="text-sm font-medium text-slate-600">{group.label}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {group.options.map((option) => {
                const selected = draft[group.key] === option.value;
                return (
                  <button
                    key={String(option.value)}
                    type="button"
                    onClick={() => select(group.key, option.value)}
                    className={`px-4 py-2 rounded-xl border text-sm font-medium transition-colors ${
                      selected
                        ? 'border-[#2563EB] bg-blue-50 text-[#2563EB]'
                        : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        <div className="mt-8 pt-5 border-t border-slate-100 flex items-center justify-between gap-4">
          <span className="text-sm text-slate-500">Saved on this device only</span>
          <button
            type="button"
            onClick={save}
            className={`px-5 py-2.5 rounded-xl text-sm font-medium transition-colors ${
              saved ? 'bg-green-600 text-white' : 'bg-[#1e3a8a] hover:bg-[#1e40af] text-white'
            }`}
          >
            {saved ? 'Saved ✓' : 'Save settings'}
          </button>
        </div>
      </div>
    </div>
  );
}
