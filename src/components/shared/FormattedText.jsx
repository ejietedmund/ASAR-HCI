import { useMemo, useState } from 'react';

const BULLET_MATCH = /^(\s*)([•◦▪▸\-\*])\s+(.*)$/;
const NUMBER_MATCH = /^(\d{1,3})[.)]\s+(.*)$/;
const HEADING_MATCH = /^#\s+(.*)$/;
const TABLE_ROW_MATCH = /^\|(.+)\|$/;
const TABLE_SEP_MATCH = /^\|?[\s:|-]+\|[\s:|-|]*$/;

const BULLET_LEVELS = { '•': 0, '◦': 1, '▪': 2, '▸': 1, '-': 0, '*': 0 };

function parseTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function isTableSeparator(line) {
  const trimmed = line.trim();
  return TABLE_SEP_MATCH.test(trimmed) && /-/.test(trimmed);
}

export function parseBlocks(body) {
  const lines = String(body || '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let paragraph = [];
  let list = null;

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ type: 'paragraph', text: paragraph.join(' ').trim() });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list && list.items.length) blocks.push(list);
    list = null;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i];
    const line = rawLine.trimEnd();
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    if (TABLE_ROW_MATCH.test(trimmed)) {
      flushParagraph();
      flushList();
      const rows = [];
      let header = null;
      let j = i;
      while (j < lines.length && TABLE_ROW_MATCH.test(lines[j].trim())) {
        const row = parseTableRow(lines[j]);
        if (!header && j + 1 < lines.length && isTableSeparator(lines[j + 1])) {
          header = row;
          j += 2;
          continue;
        }
        rows.push(row);
        j += 1;
      }
      if (header || rows.length) {
        blocks.push({ type: 'table', header: header || rows.shift() || [], rows });
      }
      i = j - 1;
      continue;
    }

    const heading = HEADING_MATCH.exec(trimmed);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ type: 'heading', text: heading[1].trim() });
      continue;
    }

    const bullet = BULLET_MATCH.exec(line);
    if (bullet) {
      flushParagraph();
      const charLevel = BULLET_LEVELS[bullet[2]] ?? 0;
      const indentLevel = Math.min(2, Math.floor(bullet[1].length / 2));
      const level = bullet[1].length > 0 ? Math.max(charLevel, indentLevel) : charLevel;
      if (!list || list.type !== 'bullets') {
        flushList();
        list = { type: 'bullets', items: [] };
      }
      list.items.push({ level, text: bullet[3].trim() });
      continue;
    }

    const numbered = NUMBER_MATCH.exec(trimmed);
    if (numbered) {
      flushParagraph();
      if (!list || list.type !== 'numbered') {
        flushList();
        list = { type: 'numbered', items: [] };
      }
      list.items.push({ level: 0, text: numbered[2].trim() });
      continue;
    }

    flushList();
    paragraph.push(trimmed);
  }
  flushParagraph();
  flushList();
  return blocks;
}

const BULLET_MARKS = ['•', '◦', '▪'];
const LIST_MARK_CLASS = [
  'text-brand/90',
  'text-brand/60',
  'text-ink3',
];

function tableAsText(header, rows) {
  const cols = Math.max(header.length, ...rows.map((r) => r.length), 0);
  const lines = [];
  const h = Array.from({ length: cols }, (_, i) => header[i] || '').filter(Boolean).join(' · ');
  if (h) lines.push(h);
  rows.forEach((row) => {
    const cells = Array.from({ length: cols }, (_, i) => row[i] || '').filter(Boolean);
    if (cells.length) lines.push(`- ${cells.join(' — ')}`);
  });
  return lines.join('\n');
}

function TableBlock({ header, rows }) {
  const cols = Math.max(header.length, ...rows.map((r) => r.length), 0);
  const normHeader = Array.from({ length: cols }, (_, i) => header[i] || '');
  const dense = cols >= 4 || rows.length >= 6;
  const large = cols >= 4 || rows.length >= 8;
  const [collapsed, setCollapsed] = useState(large);
  const [asText, setAsText] = useState(false);
  const visibleRows = collapsed ? rows.slice(0, 5) : rows;

  return (
    <div className="rounded-xl border border-sep overflow-hidden bg-card">
      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-fill/50 border-b border-sep">
        <span className="text-[12px] font-semibold uppercase tracking-wide text-ink3">Table · {rows.length} row{rows.length === 1 ? '' : 's'} × {cols} col{cols === 1 ? '' : 's'}</span>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setAsText((v) => !v)} className="text-[12px] font-medium text-brand hover:underline">
            {asText ? 'Show table' : 'Show as text'}
          </button>
          {large && !asText && (
            <button type="button" onClick={() => setCollapsed((v) => !v)} className="text-[12px] font-medium text-brand hover:underline">
              {collapsed ? 'Expand' : 'Collapse'}
            </button>
          )}
        </div>
      </div>
      {asText ? (
        <pre className="p-3 text-[14px] leading-relaxed text-ink2 whitespace-pre-wrap font-sans">{tableAsText(normHeader, rows)}</pre>
      ) : (
        <div className="overflow-x-auto">
          <table className={`min-w-full border-collapse ${dense ? 'text-[13px]' : 'text-[14px] sm:text-[15px]'}`}>
            <thead className="bg-fill/70">
              <tr>
                {normHeader.map((cell, ci) => (
                  <th key={ci} className={`px-3 ${dense ? 'py-1.5' : 'py-2'} text-left font-semibold text-ink border-b border-sep whitespace-nowrap`}>{cell}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row, ri) => (
                <tr key={ri} className={ri % 2 ? 'bg-fill/30' : 'bg-card'}>
                  {Array.from({ length: cols }, (_, ci) => (
                    <td key={ci} className={`px-3 ${dense ? 'py-1.5' : 'py-2'} text-ink2 border-t border-sep align-top`}>{row[ci] || ''}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {collapsed && rows.length > visibleRows.length && (
            <div className="px-3 py-2 text-[12px] text-ink3 border-t border-sep">Showing 5 of {rows.length} rows</div>
          )}
        </div>
      )}
    </div>
  );
}

function Blocks({ blocks, textClass, headingClass }) {
  return blocks.map((block, index) => {
    if (block.type === 'heading') {
      return (
        <h3 key={index} className={`${headingClass} font-sans text-[17px] font-semibold text-ink tracking-tight`}>
          {block.text}
        </h3>
      );
    }
    if (block.type === 'paragraph') {
      return <p key={index} className={textClass}>{block.text}</p>;
    }
    if (block.type === 'table') {
      return <TableBlock key={index} header={block.header || []} rows={block.rows || []} />;
    }
    const isNumbered = block.type === 'numbered';
    return (
      <ul key={index} className="space-y-2.5">
        {block.items.map((item, itemIndex) => {
          const mark = isNumbered ? (
            <span className="text-brand/90 font-semibold tabular-nums shrink-0">{itemIndex + 1}.</span>
          ) : (
            <span className={`${LIST_MARK_CLASS[item.level] || LIST_MARK_CLASS[2]} shrink-0`}>{BULLET_MARKS[item.level] || '•'}</span>
          );
          return (
            <li key={itemIndex} className={`flex gap-3 ${item.level > 0 ? 'ml-6' : ''}`}>
              {mark}
              <span className={`${textClass} min-w-0 flex-1`}>{item.text}</span>
            </li>
          );
        })}
      </ul>
    );
  });
}

export function FormattedText({ body, sizeClass = 'text-[17px]', fontClass = 'font-serif', headingClass = '' }) {
  const blocks = useMemo(() => parseBlocks(body), [body]);
  if (!blocks.length) return null;
  const textClass = `${fontClass} ${sizeClass} leading-[1.75] text-ink`;
  return <div className="space-y-5"><Blocks blocks={blocks} textClass={textClass} headingClass={headingClass} /></div>;
}

function figureCaption(image, index) {
  if (image.slide !== undefined && image.slide !== null) return `Figure ${index + 1} (Slide ${image.slide})`;
  if (image.page !== undefined && image.page !== null) return `Figure ${index + 1} (Page ${image.page})`;
  return `Figure ${index + 1}`;
}

export function FigureGallery({ images, title }) {
  if (!images || !images.length) return null;
  return (
    <div className="space-y-5">
      {images.map((image, index) => (
        <figure key={`${index}-${(image.src || '').slice(-24)}`} className="anim-fade">
          <div className="rounded-2xl border border-sep bg-card2 overflow-hidden flex items-center justify-center p-2">
            <img
              src={image.src}
              alt={image.alt || `${title || 'Document'} - ${figureCaption(image, index)}`}
              width={image.width}
              height={image.height}
              loading="lazy"
              className="max-w-full max-h-[52vh] w-auto h-auto object-contain rounded-xl"
            />
          </div>
          <figcaption className="mt-2 text-center text-[12px] font-medium tracking-wide text-ink3">{figureCaption(image, index)}</figcaption>
        </figure>
      ))}
    </div>
  );
}
