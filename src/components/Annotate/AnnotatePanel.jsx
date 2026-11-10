import { useState } from 'react';

const TYPES = [
  { value: 'confusing', label: 'Confusing' },
  { value: 'important', label: 'Important' },
];

export default function AnnotatePanel({ initial, onCancel, onSave }) {
  const [type, setType] = useState(initial?.type || null);
  const [note, setNote] = useState(initial?.note || '');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="w-full max-w-[576px] bg-white rounded-2xl shadow-2xl p-6 sm:p-7">
        <h2 className="text-xl font-semibold text-[#1a2340]">Mark this chunk</h2>
        <p className="mt-1 text-sm text-slate-500">Flag it so you can find it again later.</p>

        <div className="mt-5 flex flex-wrap gap-3">
          {TYPES.map((option) => {
            const selected = type === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setType(selected ? null : option.value)}
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

        <label className="block mt-5 text-sm font-medium text-slate-600" htmlFor="annotate-note">
          Note <span className="font-normal text-slate-400">(optional)</span>
        </label>
        <textarea
          id="annotate-note"
          rows={4}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Anything you want to remember about this chunk..."
          className="mt-2 w-full resize-y rounded-xl border border-slate-300 px-4 py-3 text-base text-[#1a2340] placeholder:text-slate-400 focus:outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-blue-100"
        />

        <div className="mt-5 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-xl border border-slate-300 text-sm font-medium text-[#1a2340] hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!type}
            onClick={() => onSave({ type, note })}
            className={`px-5 py-2 rounded-xl text-sm font-medium transition-colors ${
              type
                ? 'bg-[#1e3a8a] hover:bg-[#1e40af] text-white'
                : 'bg-slate-200 text-slate-400 cursor-not-allowed'
            }`}
          >
            Save mark
          </button>
        </div>
      </div>
    </div>
  );
}
