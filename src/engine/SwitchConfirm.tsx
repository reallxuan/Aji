import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import { useSwitchQuestion } from './profileStore';

/**
 * The question a switch asks while a whole-game job runs (P2 M4 design 6.2): the switch stops
 * the job, and its results stay. Mounted once, with the app.
 */
export function SwitchConfirm() {
  const { t } = useTranslation();
  const pending = useSwitchQuestion((s) => s.pending);
  const answer = useSwitchQuestion((s) => s.answer);
  return (
    <Dialog open={pending !== null} onOpenChange={(open) => !open && void answer(false)}>
      <DialogContent showCloseButton={false}>
        <DialogTitle>{t('engine.profile.switchTitle', { name: pending?.name ?? '' })}</DialogTitle>
        <DialogDescription>
          {t('engine.profile.switchBody', { done: pending?.done ?? 0, total: pending?.total ?? 0 })}
        </DialogDescription>
        <DialogFooter>
          <Button variant="outline" onClick={() => void answer(false)}>
            {t('engine.profile.cancel')}
          </Button>
          <Button onClick={() => void answer(true)}>{t('engine.profile.switch')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
