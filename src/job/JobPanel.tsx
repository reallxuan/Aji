import { useState, type ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useTrendStore } from '../analysis/trendStore';
import { useEngineStore } from '../engine/engineStore';
import { useGameStore } from '../game/gameStore';
import { useActionContext } from '../game/useActionContext';
import { useSettingsStore } from '../settings/settingsStore';
import type { JobOptions } from '../transport/generated/JobOptions';
import type { JobRange } from '../transport/generated/JobRange';
import type { JobSide } from '../transport/generated/JobSide';
import { startGameJob } from './actions';
import { DEFAULT_JOB_OPTIONS, jobEstimate } from './estimate';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-8 items-center gap-3 text-[0.84375rem]">
      <span className="w-[7rem] flex-none text-text-muted">{label}</span>
      {children}
    </div>
  );
}

/** A row's second line, under its control. */
function Sub({ children }: { children: ReactNode }) {
  return (
    <div className="-mt-1 flex min-h-8 items-center gap-1.5 pl-[7.75rem] text-[0.8125rem] text-text-muted">
      {children}
    </div>
  );
}

function Digits({
  label,
  value,
  onChange,
  width = 'w-16',
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  width?: string;
}) {
  return (
    <input
      type="text"
      inputMode="numeric"
      aria-label={label}
      className={`h-7 ${width} rounded-md border border-hairline bg-transparent px-2 text-[0.84375rem] text-text tabular-nums outline-none focus-visible:border-text-muted`}
      value={value}
      maxLength={7}
      onChange={(event) => onChange(event.target.value.replace(/\D/g, '').slice(0, 7))}
    />
  );
}

function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<[T, string]>;
  onChange(value: T): void;
}) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      aria-label={label}
      value={value}
      onValueChange={(next) => next && onChange(next as T)}
    >
      {options.map(([option, text]) => (
        <ToggleGroupItem key={option} value={option} className="px-3 whitespace-nowrap">
          {text}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

const RANGES: Array<JobRange['kind']> = ['whole', 'moves'];
const SIDES: JobSide[] = ['both', 'black', 'white'];

const number = (text: string, fallback: number) => {
  const n = Number(text);
  return text !== '' && Number.isFinite(n) && n > 0 ? n : fallback;
};

/**
 * 分析全局… (P2 M2 design 5.3, mockup section 2): the range, the side, the visits per move and the
 * boost, a line saying what the job will do, then 取消 and 开始. The choices start from the
 * remembered ones and are remembered again on 开始; Return starts.
 */
export function JobPanelContent({ onDone }: { onDone(): void }) {
  const { t } = useTranslation();
  const ctx = useActionContext();
  const saved = useSettingsStore((s) => s.settings?.jobOptions) ?? DEFAULT_JOB_OPTIONS;
  const last = useGameStore((s) => s.snapshot?.mainLineLength ?? 0);
  const nodes = useTrendStore((s) => s.nodes);
  const speed = useEngineStore((s) => s.speed);

  const [range, setRange] = useState(saved.range.kind);
  const [from, setFrom] = useState(String(saved.range.kind === 'moves' ? saved.range.from : 1));
  const [to, setTo] = useState(
    String(saved.range.kind === 'moves' ? Math.min(saved.range.to, last) : Math.max(1, last)),
  );
  const [side, setSide] = useState<JobSide>(saved.side);
  const [visits, setVisits] = useState(String(saved.visits));
  const [boost, setBoost] = useState(saved.boost.on);
  const [threshold, setThreshold] = useState(String(saved.boost.threshold));
  const [boostVisits, setBoostVisits] = useState(String(saved.boost.visits));

  const options = (): JobOptions => {
    const first = Math.min(number(from, 1), Math.max(1, last));
    return {
      range:
        range === 'whole'
          ? { kind: 'whole' }
          : { kind: 'moves', from: first, to: Math.max(first, Math.min(number(to, last), last)) },
      side,
      visits: number(visits, saved.visits),
      boost: {
        on: boost,
        threshold: number(threshold, saved.boost.threshold),
        visits: number(boostVisits, saved.boost.visits),
      },
    };
  };

  const start = () => {
    const chosen = options();
    const settings = useSettingsStore.getState().settings;
    if (settings)
      void useSettingsStore
        .getState()
        .save(ctx.transport, { ...settings, jobOptions: chosen })
        .catch(() => {});
    onDone();
    void startGameJob(ctx, chosen);
  };

  const chosen = options();
  const estimate = jobEstimate(nodes, chosen, speed);
  const minutes = estimate.seconds === null ? null : Math.ceil(estimate.seconds / 60);
  const time =
    minutes === null
      ? ''
      : minutes <= 1 && estimate.seconds! < 60
        ? t('job.estimate.underMinute')
        : t('job.estimate.minutes', { count: minutes });
  // Nothing left for the first pass: say so, instead of "the other 0".
  const note =
    estimate.positions === 0 && estimate.cached > 0
      ? [
          t('job.estimate.allCached', { count: estimate.cached }),
          boost ? t('job.estimate.boostOnly') : '',
          t('job.estimate.end'),
        ].join('')
      : [
          estimate.cached > 0 ? t('job.estimate.cached', { count: estimate.cached }) : '',
          side !== 'both'
            ? t(`job.estimate.${side}`, { count: estimate.positions })
            : t(estimate.cached > 0 ? 'job.estimate.rest' : 'job.estimate.all', {
                count: estimate.positions,
              }),
          time,
          boost ? t('job.estimate.boost') : '',
          t('job.estimate.end'),
        ].join('');

  return (
    <div
      className="w-[27rem] px-4 py-3.5"
      onKeyDown={(event) => {
        // Return starts, except on a button, which it presses.
        if (event.key !== 'Enter' || event.target instanceof HTMLButtonElement) return;
        event.preventDefault();
        start();
      }}
    >
      <h4 className="mb-2.5 text-[0.875rem] font-medium">{t('job.title')}</h4>
      <div className="flex flex-col gap-1.5">
        <Row label={t('job.range')}>
          <Choice<JobRange['kind']>
            label={t('job.range')}
            value={range}
            options={RANGES.map((kind) => [kind, t(`job.${kind}`)])}
            onChange={setRange}
          />
        </Row>
        {range === 'moves' && (
          <Sub>
            <Trans
              i18nKey="job.rangeLine"
              components={{
                from: (
                  <Digits label={t('job.fromLabel')} value={from} onChange={setFrom} width="w-14" />
                ),
                to: <Digits label={t('job.toLabel')} value={to} onChange={setTo} width="w-14" />,
              }}
            />
          </Sub>
        )}
        <Row label={t('job.side')}>
          <Choice<JobSide>
            label={t('job.side')}
            value={side}
            options={SIDES.map((option) => [option, t(`job.${option}`)])}
            onChange={setSide}
          />
        </Row>
        <Row label={t('job.visits')}>
          <Digits label={t('job.visits')} value={visits} onChange={setVisits} />
        </Row>
        <Row label={t('job.boost')}>
          <Checkbox
            aria-label={t('job.boost')}
            checked={boost}
            onCheckedChange={(checked) => setBoost(checked === true)}
          />
        </Row>
        {boost && (
          <Sub>
            <Trans
              i18nKey="job.boostLine"
              components={{
                threshold: (
                  <Digits
                    label={t('job.thresholdLabel')}
                    value={threshold}
                    onChange={setThreshold}
                    width="w-11"
                  />
                ),
                visits: (
                  <Digits
                    label={t('job.boostVisitsLabel')}
                    value={boostVisits}
                    onChange={setBoostVisits}
                  />
                ),
              }}
            />
          </Sub>
        )}
      </div>
      <p
        data-testid="job-estimate"
        className="mt-3 text-[0.78125rem] leading-relaxed text-text-muted"
      >
        {note}
        <br />
        {t('job.browse')}
      </p>
      <div className="mt-3.5 flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          {t('job.cancel')}
        </Button>
        <Button type="button" size="sm" data-start onClick={start}>
          {t('job.start')}
        </Button>
      </div>
    </div>
  );
}
