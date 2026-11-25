import { cn } from 'cn';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import { useActionContext } from '../game/useActionContext';
import { moveLastMove, useMoveMoveStore } from './moveMoveStore';

/**
 * Moving the last move (move-last-move design): the line under the edit row while the board
 * waits for the new point, off the board so no point is hidden under it.
 */
export function MoveMoveHint({ touch }: { touch: boolean }) {
  const { t } = useTranslation();
  const picking = useMoveMoveStore((s) => s.picking);
  const cancel = useMoveMoveStore((s) => s.cancel);
  if (!picking) return null;
  return (
    <div
      role="status"
      className={cn(
        'flex shrink-0 items-center gap-2 border-b border-hairline bg-accent/40 pr-2 pl-4 text-xs text-text',
        !touch && 'py-1',
      )}
    >
      {t('edit.moveHint')}
      <button
        type="button"
        className={cn(
          'ml-auto shrink-0 rounded-md px-2 whitespace-nowrap text-text-muted hover:bg-accent hover:text-text',
          touch ? 'h-11 min-w-11' : 'h-7',
        )}
        title={t('edit.withKey', { label: t('edit.moveCancel'), key: 'Esc' })}
        onClick={cancel}
      >
        {t('edit.moveCancel')}
      </button>
    </div>
  );
}

/**
 * Esc while the board waits for the new point, and the question asked when the move would make
 * later moves illegal. Mounted once, with the main board.
 */
export function MoveMovePrompt() {
  const { t } = useTranslation();
  const ctx = useActionContext();
  const picking = useMoveMoveStore((s) => s.picking);
  const confirm = useMoveMoveStore((s) => s.confirm);
  const cancel = useMoveMoveStore((s) => s.cancel);

  useEffect(() => {
    if (!picking) return;
    // Captured first, so Esc ends the picking and nothing else it may mean on the board.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      cancel();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [picking, cancel]);

  return (
    <>
      <Dialog open={!!confirm} onOpenChange={(open) => !open && cancel()}>
        <DialogContent showCloseButton={false}>
          <DialogTitle>{t('edit.moveConfirmTitle')}</DialogTitle>
          <DialogDescription>
            {t('edit.moveConfirmBody', { count: confirm?.count ?? 0 })}
          </DialogDescription>
          <DialogFooter>
            <Button variant="outline" onClick={cancel}>
              {t('edit.moveCancel')}
            </Button>
            <Button onClick={() => confirm && void moveLastMove(ctx, confirm.to, true)}>
              {t('edit.moveConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
