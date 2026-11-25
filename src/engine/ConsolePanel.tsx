import { cn } from 'cn';
import type { TFunction } from 'i18next';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { getConsoleLines, openConsole as openOnBackend, sendConsole } from '../transport/api';
import type { ConsoleRefusal } from '../transport/generated/ConsoleRefusal';
import { toTransportError } from '../transport/transport';
import { useTransport } from '../transport/TransportProvider';
import { type ConsoleFilter, type ShownLine, useConsoleStore } from './consoleStore';
import { useConsoleSheet } from './openConsole';

/** A protocol line longer than this shows its start, with 展开 (design 6.5). */
const CUT = 400;
const FILTERS: ConsoleFilter[] = ['all', 'log', 'protocol'];

const pad = (n: number) => String(n).padStart(2, '0');
const clock = (atMs: number) => {
  const d = new Date(atMs);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

const shows = (filter: ConsoleFilter, line: ShownLine) =>
  filter === 'all' ||
  (filter === 'log'
    ? line.kind === 'stderr' || line.kind === 'aji'
    : line.kind === 'sent' || line.kind === 'received');

/** A line's text: KataGo's own, or Aji's note put into words. */
function lineText(line: ShownLine, t: TFunction): string {
  if (line.refused) return t(`engine.console.refused.${line.refused}`);
  const note = line.note;
  if (!note) return line.text;
  if (note.kind === 'started') return t('engine.console.notes.started', { katago: note.katago });
  if (note.kind === 'gaveUp') return t('engine.console.notes.gaveUp');
  if (note.code !== null) return t('engine.console.notes.exitedCode', { code: note.code });
  if (note.signal !== null) return t('engine.console.notes.exitedSignal', { signal: note.signal });
  return t('engine.console.notes.exited');
}

/**
 * 引擎控制台 (P2 M4 design 6.5, mockup section 4): KataGo's log, Aji's notes and the analysis
 * protocol, newest at the bottom, and a field that sends a query with an `action`. While it is
 * shown the backend keeps protocol lines.
 */
export function ConsolePanel() {
  const { t } = useTranslation();
  const transport = useTransport();
  const lines = useConsoleStore((s) => s.lines);
  const filter = useConsoleStore((s) => s.filter);
  const paused = useConsoleStore((s) => s.paused);
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    void openOnBackend(transport, true).catch(() => {});
    getConsoleLines(transport, 0).then(
      (kept) => active && useConsoleStore.getState().append(kept),
      () => {},
    );
    return () => {
      active = false;
      void openOnBackend(transport, false).catch(() => {});
    };
  }, [transport]);

  const shown = lines.filter((line) => shows(filter, line));

  // New lines scroll into view unless 暂停滚动 is on.
  useEffect(() => {
    const el = list.current;
    if (el && !paused) el.scrollTop = el.scrollHeight;
  }, [shown.length, paused]);

  const copy = () => {
    const text = shown
      .map(
        (line) =>
          `${clock(line.atMs)} ${t(`engine.console.kinds.${line.kind}`)} ${lineText(line, t)}`,
      )
      .join('\n');
    void navigator.clipboard?.writeText(text).catch(() => {});
  };

  const bar =
    'h-6 rounded-full border border-hairline px-2 text-[11px] text-text-muted hover:text-text';
  return (
    <div className="flex h-full min-h-0 flex-col bg-panel text-[12px]">
      <div className="flex flex-none flex-wrap items-center gap-1.5 border-b border-hairline px-3 py-1.5">
        <span className="mr-1 text-[12px] font-medium">{t('engine.console.title')}</span>
        <ToggleGroup
          type="single"
          value={filter}
          onValueChange={(value) =>
            value && useConsoleStore.getState().setFilter(value as ConsoleFilter)
          }
          className="gap-1"
        >
          {FILTERS.map((f) => (
            <ToggleGroupItem
              key={f}
              value={f}
              className={cn(
                bar,
                'min-w-0 data-[state=on]:border-text-muted data-[state=on]:text-text',
              )}
            >
              {t(`engine.console.filters.${f}`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <span className="flex-1" />
        <button
          type="button"
          aria-pressed={paused}
          className={cn(bar, paused && 'border-text-muted text-text')}
          onClick={() => useConsoleStore.getState().setPaused(!paused)}
        >
          {t('engine.console.pause')}
        </button>
        <button type="button" className={bar} onClick={copy}>
          {t('engine.console.copy')}
        </button>
        <button type="button" className={bar} onClick={() => useConsoleStore.getState().clear()}>
          {t('engine.console.clear')}
        </button>
      </div>
      <div ref={list} className="min-h-0 flex-1 overflow-y-auto px-3 py-1 font-mono leading-[1.5]">
        {shown.length === 0 && (
          <p className="py-2 font-sans text-text-muted">{t('engine.console.empty')}</p>
        )}
        {shown.map((line) => {
          const text = lineText(line, t);
          const protocol = line.kind === 'sent' || line.kind === 'received';
          const long = protocol && text.length > CUT && !expanded.has(line.seq);
          return (
            <div
              key={line.seq}
              data-testid="console-line"
              className={cn('flex gap-2 py-px', line.refused && 'text-engine-error')}
            >
              <span className="flex-none text-text-muted tabular-nums">{clock(line.atMs)}</span>
              <span
                className={cn(
                  'w-8 flex-none font-sans',
                  line.kind === 'sent' && 'text-sky-600 dark:text-sky-400',
                  line.kind === 'received' && 'text-emerald-700 dark:text-emerald-400',
                  line.kind === 'stderr' && 'text-text-muted',
                )}
              >
                {t(`engine.console.kinds.${line.kind}`)}
              </span>
              <span className="min-w-0 flex-1 break-all whitespace-pre-wrap">
                {long ? `${text.slice(0, CUT)}…` : text}
                {protocol && text.length > CUT && (
                  <button
                    type="button"
                    className="ml-2 font-sans text-text-muted underline hover:text-text"
                    onClick={() =>
                      setExpanded((set) => {
                        const next = new Set(set);
                        if (next.has(line.seq)) next.delete(line.seq);
                        else next.add(line.seq);
                        return next;
                      })
                    }
                  >
                    {long ? t('engine.console.expand') : t('engine.console.collapse')}
                  </button>
                )}
              </span>
            </div>
          );
        })}
      </div>
      <QueryField />
    </div>
  );
}

/** The one-line query field: Enter sends, Up and Down recall what was sent. */
function QueryField() {
  const { t } = useTranslation();
  const transport = useTransport();
  const [text, setText] = useState('');
  const [recall, setRecall] = useState<{ index: number; draft: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    const query = text.trim();
    if (!query) return;
    const store = useConsoleStore.getState();
    store.remember(query);
    setRecall(null);
    setError(null);
    try {
      await sendConsole(transport, query);
      setText('');
    } catch (failure) {
      const { code, detail } = toTransportError(failure);
      if (code === 'engineConsoleRefused' && detail) store.refused(detail as ConsoleRefusal);
      else if (code === 'engineNotRunning') store.refused('notRunning');
      else setError(t(`errors.${code}`));
    }
  };

  const step = (by: -1 | 1) => {
    const { history } = useConsoleStore.getState();
    if (history.length === 0) return;
    if (by === -1) {
      const index = recall ? Math.max(0, recall.index - 1) : history.length - 1;
      setRecall({ index, draft: recall?.draft ?? text });
      setText(history[index]);
    } else if (recall) {
      const index = recall.index + 1;
      if (index >= history.length) {
        setText(recall.draft);
        setRecall(null);
      } else {
        setRecall({ ...recall, index });
        setText(history[index]);
      }
    }
  };

  return (
    <div className="flex-none border-t border-hairline px-3 py-1.5">
      <input
        type="text"
        spellCheck={false}
        aria-label={t('engine.console.input')}
        placeholder={t('engine.console.placeholder')}
        className="h-7 w-full rounded-md border border-hairline bg-transparent px-2 font-mono text-[12px] outline-none placeholder:text-text-muted focus-visible:border-text-muted"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setRecall(null);
        }}
        onKeyDown={(event) => {
          // The board's keys stay out of the field.
          event.stopPropagation();
          // This Enter picks the input method's text, it does not send.
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Enter') void send();
          else if (event.key === 'ArrowUp') {
            event.preventDefault();
            step(-1);
          } else if (event.key === 'ArrowDown') {
            event.preventDefault();
            step(1);
          }
        }}
      />
      {error && (
        <p role="alert" className="mt-1 text-engine-error">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * The console in the narrow arrangement: a sheet rising to 78% of the height over the panels,
 * closed by its grip or a tap outside.
 */
export function ConsoleSheet() {
  const { t } = useTranslation();
  const open = useConsoleSheet((s) => s.open);
  if (!open) return null;
  const close = () => useConsoleSheet.getState().setOpen(false);
  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end">
      <button
        type="button"
        aria-label={t('layout.narrow.close')}
        tabIndex={-1}
        className="min-h-0 flex-1 bg-black/30"
        onClick={close}
      />
      <div
        role="dialog"
        aria-label={t('engine.console.title')}
        className="flex h-[78%] flex-col rounded-t-xl border-t border-hairline bg-panel"
      >
        <button
          type="button"
          aria-label={t('layout.narrow.close')}
          className="flex h-6 flex-none items-center justify-center"
          onClick={close}
        >
          <span className="h-1 w-10 rounded-full bg-hairline" aria-hidden />
        </button>
        <div className="min-h-0 flex-1">
          <ConsolePanel />
        </div>
      </div>
    </div>
  );
}
