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
import { BoardCanvas } from '../board/BoardCanvas';
import { sameStyle, SETS, type StyleChoice } from '../board/styles';
import { useBoardStyle } from '../board/useBoardStyle';
import { BOARD_IDS, type BoardId, STONE_IDS, type StoneId } from '../device/deviceSettings';
import { useDeviceStore } from '../device/deviceStore';
import type { Color } from '../transport/generated/Color';

const THUMB = 72;
/** A corner of a game on a 9×9 board, enough to show the wood and both stones. */
const SAMPLE: (Color | null)[] = Array.from({ length: 81 }, (_, i) =>
  [20, 22, 30, 40, 48].includes(i) ? 'black' : [21, 31, 32, 39, 50].includes(i) ? 'white' : null,
);

function Thumbnail({ style }: { style: StyleChoice }) {
  return (
    <BoardCanvas
      cssSize={THUMB}
      boardSize={9}
      stones={SAMPLE}
      lastMove={null}
      coordinates={false}
      boardStyle={style.board}
      stoneStyle={style.stones}
    />
  );
}

/**
 * 设置 → 界面 → 棋盘 (P2 M1 design 5.7): the four sets as thumbnails, and 自定义, a tile of the
 * same size, which shows a select for the board and one for the stones, starting from the style
 * in use.
 */
export function BoardStyleControl() {
  const { t } = useTranslation();
  const current = useBoardStyle();
  const update = useDeviceStore((s) => s.update);
  const [customOpen, setCustomOpen] = useState(false);
  const mix = !SETS.some((set) => sameStyle(set, current));
  const custom = customOpen || mix;
  const name = (style: StyleChoice) =>
    t('settings.board.set', {
      board: t(`settings.board.boards.${style.board}`),
      stones: t(`settings.board.stones.${style.stones}`),
    });
  const choose = (style: StyleChoice) => update({ boardStyle: style });
  const tile = 'flex flex-col items-center gap-1.5 rounded-md p-1 text-[12px] text-text-muted';
  const on = 'text-text ring-2 ring-text';

  return (
    <div className="space-y-3">
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
    </div>
  );
}
