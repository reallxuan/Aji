import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useDeviceStore } from '../device/deviceStore';
import { useEngineStore } from '../engine/engineStore';
import { BottomNav } from '../panel/BottomNav';
import { EngineStatus } from '../panel/EngineStatus';
import { NoEngine } from '../panel/NoEngine';
import { NoticeLine } from '../panel/NoticeLine';
import { PanelHeader } from '../panel/PanelHeader';
import { TabRow } from '../panel/TabRow';
import { PHONE_WIDTH } from './constants';
import { MainBoard } from './MainBoard';
import { type PanelRef, panelsOf, refId } from './model';
import { PanelView } from './PanelView';
import { PanelSizeContext } from './usePanelWidth';
import { WinrateBar } from '../panel/WinrateBar';
import { panelLabelKey } from './registry';
import { Sheet } from './Sheet';
import { useLayout } from './useLayout';
import { useWindowSize } from './useWindowSize';

/** The board keeps at least this much height for the panels under it. */
const PANELS_MIN = 160;
/** ...but never at the cost of the board falling below its floor (design 5.5, Review Focus 4). */
const BOARD_FLOOR = 320;
const HEADER = { phone: 52, tablet: 56 };
const BAR = 48;
const NAV = 72;

/**
 * The narrow arrangement (P2 M1 design 5.5), top to bottom: the header, the notice line and
 * engine status when they have something, the board at the full width less 4 px each side, the
 * win-rate bar, the other panels as tabs in layout order, and (under 700 px) the bottom
 * navigation. From 700 px the first two panels show side by side, a strip choosing the second
 * when there are more. The wizard, settings and About open over it as a sheet.
 */
export function NarrowFrame({
  overlay,
  side,
  onCloseSide,
  sideLocked = false,
}: {
  overlay?: ReactNode;
  side?: ReactNode;
  onCloseSide?(): void;
  sideLocked?: boolean;
}) {
  const { t } = useTranslation();
  const { width, height } = useWindowSize();
  const { layout } = useLayout();
  const notConfigured = useEngineStore((s) => s.engine?.state === 'notConfigured');
  const narrowTab = useDeviceStore((s) => s.settings.narrowTab);
  const update = useDeviceStore((s) => s.update);
  const phone = width < PHONE_WIDTH;

  const visible = panelsOf(layout.root);
  const tabs = visible.filter((p) => p.kind !== 'header' && p.kind !== 'winrate');
  const bar = visible.some((p) => p.kind === 'winrate');
  const subboards = tabs.filter((p) => p.kind === 'subboard').length;
  const label = (ref: PanelRef) =>
    ref.kind === 'subboard' && subboards > 1
      ? t('layout.subboardRank', { rank: ref.rank })
      : t(panelLabelKey(ref));
  // The tablet shows the first tab always; the strip chooses among the rest.
  const choosable = phone ? tabs : tabs.slice(1);
  const active = Math.max(
    0,
    choosable.findIndex((p) => refId(p) === narrowTab),
  );
  const select = (ref: PanelRef) => update({ narrowTab: refId(ref) });

  const barHeight = bar ? BAR : 0;
  // The height left for the board and the panels; the panels keep 160 px of it only while the
  // board keeps its floor, so a small landscape window shows the board first.
  const room = height - (phone ? HEADER.phone + NAV : HEADER.tablet) - barHeight;
  const boardRoom = Math.max(Math.min(BOARD_FLOOR, room), room - PANELS_MIN);
  const size = Math.max(0, Math.floor(Math.min(width - 8, boardRoom)));
  // Thinking draws the hovered line on sub-board 1 only while that sub-board is on screen.
  const isFirstSub = (ref: PanelRef | undefined) => ref?.kind === 'subboard' && ref.rank === 1;
  const subOnScreen = phone
    ? isFirstSub(choosable[active])
    : isFirstSub(tabs[0]) || isFirstSub(choosable[active]);
  const lines = layout.lines === 'subboard' && subOnScreen ? 'subboard' : 'board';
  // Before the app is ready the side is a placeholder: the board shows, and nothing else yet.
  const placeholder = side !== undefined && !onCloseSide;

  const strip = (panels: PanelRef[]) => (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {(phone || panels.length > 1) && (
        <TabRow panels={panels} active={active} onSelect={select} label={label} touch />
      )}
      {panels[active] && <PanelView panel={panels[active]} />}
    </div>
  );

  return (
    <div data-narrow className="flex h-full w-full flex-col bg-panel">
      {!placeholder && (
        <>
          <PanelHeader compact={phone} touch />
          <NoticeLine />
          {notConfigured ? <NoEngine /> : <EngineStatus />}
        </>
      )}
      <div className="relative flex-none bg-ground" style={{ height: size + 8 }}>
        <MainBoard
          rect={{ x: Math.round((width - size) / 2), y: 4, width: size, height: size }}
          overlay={overlay}
          lines={lines}
        />
      </div>
      {!placeholder && (
        <>
          {bar && (
            // The bar is the board's, not a tab: drawn as it is, with no grip.
            <div className="h-12 flex-none border-t border-hairline">
              <PanelSizeContext.Provider value={{ width, height: BAR }}>
                <WinrateBar />
              </PanelSizeContext.Provider>
            </div>
          )}
          <div className="flex min-h-0 flex-1 border-t border-hairline">
            {phone || tabs.length < 2 ? (
              strip(tabs)
            ) : (
              <>
                <div className="flex min-h-0 min-w-0 flex-1">
                  <PanelView panel={tabs[0]} />
                </div>
                <div className="flex min-h-0 min-w-0 flex-1 border-l border-hairline">
                  {strip(choosable)}
                </div>
              </>
            )}
          </div>
          {phone && <BottomNav />}
        </>
      )}
      {side !== undefined && onCloseSide && (
        <Sheet onClose={sideLocked ? undefined : onCloseSide}>{side}</Sheet>
      )}
    </div>
  );
}
