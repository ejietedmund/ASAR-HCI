import { useEffect, useRef, useState } from 'react';

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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="w-full max-w-[576px] bg-white rounded-2xl shadow-2xl p-6 sm:p-7">
        <span className="inline-block bg-[#2563EB] text-white text-xs font-semibold px-3 py-1 rounded-full">
          Quick check
        </span>

        <h2 className="mt-4 text-xl sm:text-2xl font-semibold text-[#1a2340] leading-snug">
          {checkpointPrompt(chunkIndex)}
        </h2>
        <p className="mt-2 text-sm text-slate-500">Answer from memory. There is no grade.</p>

        <textarea
          ref={textareaRef}
          rows={5}
          value={answer}
          onChange={(event) => setAnswer(event.target.value)}
          placeholder="Type your answer..."
          className="mt-4 w-full resize-y rounded-xl border border-slate-300 px-4 py-3 text-base text-[#1a2340] placeholder:text-slate-400 focus:outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-blue-100"
        />

        <div className="mt-5 flex items-center justify-between gap-3">
          <span className="text-sm text-slate-500">After chunk {chunkNumber}</span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onSkip}
              className="px-4 py-2 rounded-xl border border-slate-300 text-sm font-medium text-[#1a2340] hover:bg-slate-50 transition-colors"
            >
              Skip
            </button>
            <button
              type="button"
              onClick={() => onSubmit(answer)}
              className="px-5 py-2 rounded-xl bg-[#1e3a8a] hover:bg-[#1e40af] text-white text-sm font-medium transition-colors"
            >
              Submit
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
