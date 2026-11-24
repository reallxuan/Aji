import { createRoot } from 'react-dom/client';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '../components/ui/dialog';
import type { DiscardChoice } from './files';

function DiscardDialog({ choose }: { choose: (answer: DiscardChoice) => void }) {
  const { t } = useTranslation();
  const cancel = () => choose('cancel');
  const discard = () => choose('discard');
  const save = () => choose('save');
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) cancel();
      }}
    >
      <DialogContent aria-describedby={undefined} showCloseButton={false}>
        <DialogTitle>{t('unsaved.title')}</DialogTitle>
        <DialogFooter>
          <Button variant="outline" onClick={cancel}>
            {t('setup.cancel')}
          </Button>
          <Button variant="outline" onClick={discard}>
            {t('unsaved.discard')}
          </Button>
          <Button onClick={save}>{t('commands.file.save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A modal in the development web client, where there is no native dialog service. */
export function browserConfirmDiscard(): Promise<DiscardChoice> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  return new Promise((resolve) => {
    root.render(
      <DiscardDialog
        choose={(choice) => {
          root.unmount();
          host.remove();
          resolve(choice);
        }}
      />,
    );
  });
}
