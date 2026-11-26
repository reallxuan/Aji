import { cn } from 'cn';
import { SlidersHorizontalIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { BoardCanvas } from '../board/BoardCanvas';
import { BOARD_STYLES, sameStyle, SETS, type StyleChoice } from '../board/styles';
import { useBoardStyle, useGrainStrength } from '../board/useBoardStyle';
import { BOARD_IDS, type BoardId, STONE_IDS, type StoneId } from '../device/deviceSettings';
import type { Theme } from '../theme/theme';
import { useResolvedTheme } from '../theme/useResolvedTheme';
import { useDeviceStore } from '../device/deviceStore';
import type { Color } from '../transport/generated/Color';

const THUMB = 72;
/** The other theme's select value for a mix, which is no set. */
const MIX = 'custom';
/** A corner of a game on a 9×9 board, enough to show the wood and both stones. */
const SAMPLE: (Color | null)[] = Array.from({ length: 81 }, (_, i) =>
  [20, 22, 30, 40, 48].includes(i) ? 'black' : [21, 31, 32, 39, 50].includes(i) ? 'white' : null,
);

function Thumbnail({ style }: { style: StyleChoice }) {
  const grain = useGrainStrength();
  return (
    <BoardCanvas
      cssSize={THUMB}
      boardSize={9}
      stones={SAMPLE}
      lastMove={null}
      coordinates={false}
      boardStyle={style.board}
      stoneStyle={style.stones}
      grainStrength={grain}
    />
  );
}

/**
 * 设置 → 界面 → 木纹强度 (UI polish design 3): one strength for every wood board, from none to the
 * photographs' full grain, in steps of 5%. The boards follow it while it is dragged. It rests
 * only when neither theme's board has grain (dark boards design).
 */
export function GrainStrengthControl() {
  const { t, i18n } = useTranslation();
  const strength = useGrainStrength();
  const dark = useBoardStyle('dark').board;
  const light = useBoardStyle('light').board;
  const update = useDeviceStore((s) => s.update);
  const plain = !BOARD_STYLES[dark].grain && !BOARD_STYLES[light].grain;
  const percent = new Intl.NumberFormat(i18n.language, { style: 'percent' });
  return (
    <div
      className="flex items-center gap-3"
      title={plain ? t('settings.board.noGrain') : undefined}
    >
      <Slider
        className="w-40"
        aria-label={t('settings.board.grain')}
        min={0}
        max={1}
        step={0.05}
        value={[strength]}
        disabled={plain}
        onValueChange={([value]) => update({ grainStrength: Math.round(value * 20) / 20 })}
      />
      <span className="w-10 text-[0.8125rem] text-text-muted tabular-nums">
        {percent.format(strength)}
      </span>
    </div>
  );
}

/**
 * 设置 → 界面 → 棋盘 (P2 M1 design 5.7, dark boards design S3): the sets as thumbnails, and
 * 自定义, a tile of the same size, which shows a select for the board and one for the stones,
 * starting from the style in use. They set the board of the theme the window is in; one line
 * under them sets the other theme's.
 */
export function BoardStyleControl() {
  const { t } = useTranslation();
  const theme = useResolvedTheme();
  const other: Theme = theme === 'dark' ? 'light' : 'dark';
  const current = useBoardStyle(theme);
  const otherStyle = useBoardStyle(other);
  const update = useDeviceStore((s) => s.update);
  const [customOpen, setCustomOpen] = useState(false);
  const isMix = (style: StyleChoice) => !SETS.some((set) => sameStyle(set, style));
  const mix = isMix(current);
  const custom = customOpen || mix;
  const otherMix = isMix(otherStyle);
  const name = (style: StyleChoice) =>
    t('settings.board.set', {
      board: t(`settings.board.boards.${style.board}`),
      stones: t(`settings.board.stones.${style.stones}`),
    });
  const choose = (style: StyleChoice, which: Theme = theme) =>
    update({
      boardStyles: { ...useDeviceStore.getState().settings.boardStyles, [which]: style },
    });
  const tile = 'flex flex-col items-center gap-1.5 rounded-md p-1 text-[0.75rem] text-text-muted';
  const on = 'text-text ring-2 ring-text';

  return (
    <div className="space-y-3">
      <p className="text-[0.75rem] text-text-muted">{t(`settings.board.inTheme.${theme}`)}</p>
      <div
        role="radiogroup"
        aria-label={t('settings.board.title')}
        className="flex flex-wrap items-start gap-2"
      >
        {SETS.map((set) => {
          const checked = !custom && sameStyle(set, current);
          return (
            <button
              key={`${set.board}-${set.stones}`}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={name(set)}
              className={cn(tile, checked && on)}
              onClick={() => {
                setCustomOpen(false);
                choose(set);
              }}
            >
              <Thumbnail style={set} />
              <span aria-hidden>{t(`settings.board.boards.${set.board}`)}</span>
            </button>
          );
        })}
        <button
          type="button"
          role="radio"
          aria-checked={custom}
          className={cn(tile, custom && on)}
          onClick={() => setCustomOpen(true)}
        >
          {/* A tile like the sets': the mix in use, or a dashed square inviting one. */}
          <span
            data-swatch
            className={cn(
              'flex items-center justify-center text-text-muted',
              !mix && 'rounded-[2px] border border-dashed border-line',
            )}
            style={{ width: THUMB, height: THUMB }}
          >
            {mix ? (
              <Thumbnail style={current} />
            ) : (
              <SlidersHorizontalIcon className="size-5" aria-hidden />
            )}
          </span>
          <span>{t('settings.board.custom')}</span>
        </button>
      </div>
      {custom && (
        <div className="flex gap-3">
          <Select
            value={current.board}
            onValueChange={(board) => choose({ ...current, board: board as BoardId })}
          >
            <SelectTrigger size="sm" className="w-28" aria-label={t('settings.board.board')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BOARD_IDS.map((id) => (
                <SelectItem key={id} value={id}>
                  {t(`settings.board.boards.${id}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={current.stones}
            onValueChange={(stones) => choose({ ...current, stones: stones as StoneId })}
          >
            <SelectTrigger size="sm" className="w-28" aria-label={t('settings.board.stones.title')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STONE_IDS.map((id) => (
                <SelectItem key={id} value={id}>
                  {t(`settings.board.stones.${id}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="flex items-center gap-2 text-[0.75rem] text-text-muted">
        <span aria-hidden>{t(`settings.board.inTheme.${other}`)}</span>
        <Select
          value={otherMix ? MIX : otherStyle.board}
          onValueChange={(board) => {
            const set = SETS.find((s) => s.board === board);
            if (set) choose(set, other);
          }}
        >
          <SelectTrigger
            size="sm"
            className="w-28"
            aria-label={t(`settings.board.inTheme.${other}`)}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SETS.map((set) => (
              <SelectItem key={set.board} value={set.board}>
                {t(`settings.board.boards.${set.board}`)}
              </SelectItem>
            ))}
            {/* A mix is made in its own theme; here it is only kept. */}
            {otherMix && <SelectItem value={MIX}>{t('settings.board.custom')}</SelectItem>}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
