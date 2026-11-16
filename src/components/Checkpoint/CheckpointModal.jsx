import { useEffect, useRef, useState } from 'react';
import { AlertActions, AlertBody, Modal } from '../shared/ui.jsx';

const PROMPTS = [
  'In your own words, summarise the main idea of what you just read.',
  'What is one thing from the last section that you want to remember?',
  'If you had to explain this section to a classmate in two sentences, what would you say?',
  'What question does this section answer?',
  'What surprised you or stood out in what you just read?',
  'How does what you just read connect to what you already know about this topic?',
  'What is the most important term or concept introduced in this section?',
  'Describe the key point of this section without looking at it.',
];

export function checkpointPrompt(chunkIndex) {
  const index = ((chunkIndex % PROMPTS.length) + PROMPTS.length) % PROMPTS.length;
  return PROMPTS[index];
}

export default function CheckpointModal({ chunkNumber, chunkIndex, onSubmit, onSkip }) {
  const [answer, setAnswer] = useState('');
  const textareaRef = useRef(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (textareaRef.current) textareaRef.current.focus();
    }, 50);
    return () => clearTimeout(timer);
  }, []);

  return (
    <Modal onClose={onSkip} labelled>
      <AlertBody badge="Quick check" badgeClass="bg-brand-soft text-brand" title={checkpointPrompt(chunkIndex)}>
        <p className="text-ink2">Answer from memory. There is no grade.</p>
        <textarea
          ref={textareaRef}
          rows={5}
          value={answer}
          onChange={(event) => setAnswer(event.target.value)}
          placeholder="Type your answer…"
          className="mt-4 w-full resize-y rounded-2xl border border-sep bg-bg px-4 py-3 text-[16px] text-ink placeholder:text-ink3 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/25 transition-colors"
        />
        <p className="mt-3 text-[12px] text-ink3">After chunk {chunkNumber}</p>
      </AlertBody>
      <AlertActions
        actions={[
          { label: 'Skip', onClick: onSkip },
          { label: 'Submit', primary: true, onClick: () => onSubmit(answer) },
        ]}
      />
    </Modal>
  );
}
