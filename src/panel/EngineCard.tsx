import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useEngineStore } from '../engine/engineStore';
import { useJobStore } from '../job/jobStore';
import { useSettingsStore } from '../settings/settingsStore';
import { getEngineStatus } from '../transport/api';
import type { RunningEngine } from '../transport/generated/RunningEngine';
import { useTransport } from '../transport/TransportProvider';
import { engineAction } from '../engine/engineAction';

/** Network names are cut in the middle to this many characters, keeping both ends. */
const NETWORK_CHARS = 24;

export function middleTruncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = Math.ceil((max - 1) / 2);
  const tail = max - 1 - head;
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`;
}

/**
 * The engine indicator's hover card (design 5.9): the state, speed, visits, engine and network,
 * and what a click does. It asks for the engine status when it opens, for the running files.
 */
export function EngineCard() {
  const { t, i18n } = useTranslation();
  const transport = useTransport();
  const engine = useEngineStore((s) => s.engine);
  const analysis = useEngineStore((s) => s.analysis);
  const speed = useEngineStore((s) => s.speed);
  const job = useJobStore((s) => s.progress);
  const limit = useSettingsStore((s) => s.settings?.visitLimit ?? null);
  const [running, setRunning] = useState<RunningEngine | null>(null);

  useEffect(() => {
    let active = true;
    getEngineStatus(transport).then(
      (status) => {
        if (active) setRunning(status.running);
      },
      () => {},
    );
    return () => {
      active = false;
    };
  }, [transport]);

  if (!engine) return null;
  const grouped = new Intl.NumberFormat(i18n.language);
  const atLimit = engine.state === 'ready' && engine.limitReached;
  const title = atLimit ? t('engine.limitReached') : t(`engine.card.title.${engine.state}`);
  const version = 'version' in engine ? engine.version : null;
  const visits = analysis?.rootVisits ?? null;
  const action = engineAction(engine, job);

  const rows: Array<[string, string]> = [];
  if (engine.state === 'analysing' && speed !== null)
    rows.push([
      t('engine.card.speed'),
      t('engine.card.speedValue', { speed: grouped.format(Math.round(speed)) }),
    ]);
  if (visits !== null)
    rows.push([
      t('engine.card.visits'),
      atLimit
        ? t('engine.card.visitsOfLimit', {
            visits: grouped.format(visits),
            limit: grouped.format(Math.max(visits, limit ?? 0)),
          })
        : grouped.format(visits),
    ]);
  if (version)
    rows.push([
      t('engine.card.engine'),
      running?.backend
        ? t('engine.card.engineWithBackend', {
            version,
            backend: t(`setup.backend.names.${running.backend}`),
          })
        : t('engine.card.engineValue', { version }),
    ]);
  if (running)
    rows.push([t('engine.card.network'), middleTruncate(running.networkName, NETWORK_CHARS)]);

  const hint =
    action === 'pause'
      ? t('engine.card.hint.pause')
      : action === 'resume'
        ? t('engine.card.hint.resume')
        : action === 'continue' && limit !== null
          ? t('engine.card.hint.continue', { visits: grouped.format(limit) })
          : null;

  return (
    <div className="text-[0.78125rem] leading-[1.7] whitespace-nowrap tabular-nums">
      <div className="mb-1 text-[0.8125rem] font-semibold">{title}</div>
      {rows.map(([label, value]) => (
        <div key={label}>
          <span className="inline-block w-14 text-text-muted">{label}</span>
          {value}
        </div>
      ))}
      {hint && (
        <div className="mt-1.5 border-t border-hairline pt-1.5 text-xs text-text-muted">{hint}</div>
      )}
    </div>
  );
}
