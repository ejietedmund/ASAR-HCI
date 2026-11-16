import { useState } from 'react';
import { AlertActions, AlertBody, Modal } from '../shared/ui.jsx';

const TYPES = [
  { value: 'confusing', label: 'Confusing' },
  { value: 'important', label: 'Important' },
];

export default function AnnotatePanel({ initial, chunkNumber, onCancel, onSave }) {
  const [type, setType] = useState(initial?.type || null);
  const [note, setNote] = useState(initial?.note || '');

  return (
    <Modal onClose={onCancel} labelled>
      <AlertBody
        badge={chunkNumber ? `Mark chunk · Chunk ${chunkNumber}` : 'Mark chunk'}
        badgeClass="bg-brand-soft text-brand"
        title="Flag this chunk"
      >
        <p className="text-ink2">Tag it so you can find it again later.</p>
        <div className="mt-4 flex flex-wrap gap-2.5">
          {TYPES.map((option) => {
            const selected = type === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setType(selected ? null : option.value)}
                className={`px-4 py-2.5 rounded-full text-[14px] font-semibold border transition-all active:scale-[0.97] ${
                  selected
                    ? 'border-brand bg-brand-soft text-brand'
                    : 'border-sep bg-card text-ink2 hover:bg-fill'
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
        <label className="block mt-5 text-[14px] font-medium text-ink" htmlFor="annotate-note">
          Note <span className="font-normal text-ink3">(optional)</span>
        </label>
        <textarea
          id="annotate-note"
          rows={4}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Anything you want to remember about this chunk…"
          className="mt-2 w-full resize-y rounded-2xl border border-sep bg-bg px-4 py-3 text-[16px] text-ink placeholder:text-ink3 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/25 transition-colors"
        />
      </AlertBody>
      <AlertActions
        actions={[
          { label: 'Cancel', onClick: onCancel },
          {
            label: 'Save mark',
            primary: true,
            className: !type ? 'opacity-40 pointer-events-none' : '',
            onClick: () => onSave({ type, note }),
          },
        ]}
      />
    </Modal>
  );
}
