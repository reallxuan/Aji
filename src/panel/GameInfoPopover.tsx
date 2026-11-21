import { useTranslation } from 'react-i18next';
import { setRules } from '../game/actions';
import { useGameStore } from '../game/gameStore';
import { formatKomi, komiOf, scoringOf } from '../game/komi';
import { useActionContext } from '../game/useActionContext';
import { RulesControl } from '../settings/RulesControl';
import type { AnalysisRules } from '../transport/generated/AnalysisRules';
import type { TFunction } from 'i18next';

function describe(rules: AnalysisRules, t: TFunction): string {
  if (rules.kind !== 'custom') return t(`rules.described.${rules.kind}`);
  return t('rules.described.custom', {
    scoring: t(`rules.${scoringOf(rules)}`),
    komi: formatKomi(komiOf(rules)),
  });
}

function Stone({ color, label }: { color: 'black' | 'white'; label: string }) {
  const look =
    color === 'black'
      ? 'bg-[radial-gradient(circle_at_35%_30%,#666,#111_60%)]'
      : 'bg-[radial-gradient(circle_at_35%_30%,#fff,#ddd8cc_80%)] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.18)]';
  return (
    <span role="img" aria-label={label} className={`size-3.5 flex-none rounded-full ${look}`} />
  );
}

const Code = ({ children }: { children: string }) => (
  <code className="rounded-xs bg-divider-soft px-1 font-mono text-[0.71875rem] text-text">
    {children}
  </code>
);

/** What the file wrote and how Aji read it, with a way back to that reading. */
function RulesSource() {
  const { t } = useTranslation();
  const ctx = useActionContext();
  const rules = useGameStore((s) => s.snapshot?.rules);
  if (!rules) return null;
  const codes = [rules.ru && `RU[${rules.ru}]`, rules.km && `KM[${rules.km}]`].filter(
    (c): c is string => Boolean(c),
  );
  const restore = (
    <button
      type="button"
      className="ml-1 text-text underline decoration-line underline-offset-3 hover:decoration-text"
      onClick={() => void setRules(ctx, null)}
    >
      {t('rules.source.restore')}
    </button>
  );
  let text;
  if (codes.length === 0) {
    text = rules.changed ? t('rules.source.changedNone') : t('rules.source.none');
  } else {
    const lead = rules.changed ? t('rules.source.changedLead') : t('rules.source.sameLead');
    const tail = rules.changed ? 'rules.source.wasReadAs' : 'rules.source.readAs';
    text = (
      <>
        {lead}
        {codes.map((code) => (
          <span key={code}>
            {' '}
            <Code>{code}</Code>
          </span>
        ))}
        {t(tail, { rules: describe(rules.fromFile, t) })}
      </>
    );
  }
  return (
    <p data-testid="rules-source" className="mt-1 text-[0.75rem] leading-relaxed text-text-muted">
      {text}
      {rules.changed && restore}
    </p>
  );
}

function Info() {
  const { t } = useTranslation();
  const info = useGameStore((s) => s.snapshot?.info);
  if (!info) return null;
  const event = [info.event, info.round].filter(Boolean).join(' ');
  const rows: Array<[string, string | null]> = [
    [t('gameInfo.result'), info.result],
    [t('gameInfo.date'), info.date],
    [t('gameInfo.event'), event || null],
    [t('gameInfo.place'), info.place],
    [t('gameInfo.handicap'), info.handicap ? String(info.handicap) : null],
  ];
  const shown = rows.filter((row): row is [string, string] => Boolean(row[1]));
  const players: Array<['black' | 'white', string | null, string | null]> = [
    ['black', info.black, info.blackRank],
    ['white', info.white, info.whiteRank],
  ];
  if (!info.black && !info.white && shown.length === 0)
    return <p className="text-[0.8125rem] text-text-muted">{t('gameInfo.empty')}</p>;
  return (
    <>
      {players.map(([color, name, rank]) => (
        <div key={color} className="flex items-center gap-2.5 py-0.5 text-[0.875rem]">
          <Stone color={color} label={t(`gameInfo.${color}`)} />
          <span className="truncate">{name ?? '?'}</span>
          {rank && <span className="text-[0.78125rem] text-text-muted">{rank}</span>}
        </div>
      ))}
      {shown.length > 0 && (
        <dl className="mt-2.5 grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-1 text-[0.8125rem]">
          {shown.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-text-muted">{label}</dt>
              <dd className="min-w-0 break-words">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </>
  );
}

const Heading = ({ children }: { children: string }) => (
  <h4 className="mb-2.5 text-[0.75rem] font-medium tracking-wide text-text-muted">{children}</h4>
);

/** The game information popover's body (mockup frame C): the record, then the analysis rules. */
export function GameInfoContent() {
  const { t } = useTranslation();
  const ctx = useActionContext();
  const current = useGameStore((s) => s.snapshot?.rules.current);
  // 340 px as designed, or wider when a language's rule names need it (English).
  return (
    <div className="w-min min-w-[340px]">
      <section className="px-4 py-3.5">
        <Heading>{t('gameInfo.title')}</Heading>
        <Info />
      </section>
      <section className="border-t border-hairline px-4 py-3.5">
        <Heading>{t('rules.title')}</Heading>
        {current && (
          <RulesControl value={current} onChange={(rules) => void setRules(ctx, rules)} />
        )}
        <RulesSource />
      </section>
    </div>
  );
}
