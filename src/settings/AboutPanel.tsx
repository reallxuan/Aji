import { ChevronRightIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { usePanelStore } from '../app/panelStore';
import interOfl from '../assets/fonts/OFL-Inter.txt?raw';
import wenkaiOfl from '../assets/fonts/OFL-LXGWWenKai.txt?raw';
import katagoLicence from '../assets/notices/katago.txt?raw';
import networksLicence from '../assets/notices/networks.txt?raw';
import { VersionLine } from '../panel/VersionLine';
import { openExternal } from '../platform/openExternal';
import { NoticeView, PanelTitle } from './NoticeView';

export const SOURCE_URL = 'https://github.com/reallxuan/Aji';
const SOURCE_LABEL = SOURCE_URL.replace('https://', '');

const toSettings = () => usePanelStore.getState().show('settings');

/** The generated list is large, so it is loaded only when opened. */
const loadOthers = () =>
  import('../assets/notices/third-party.txt?raw').then((module) => module.default);

type Item = { key: string; name: string; licence: string; text: string | (() => Promise<string>) };

/** About Aji (G4): version, licence, source, and the licence of everything else it ships. */
export function AboutPanel() {
  const { t } = useTranslation();
  const [open, setOpen] = useState<{ title: string; text: string | null } | null>(null);

  const items: Item[] = [
    {
      key: 'katago',
      name: t('about.katago'),
      licence: t('about.katagoLicence'),
      text: katagoLicence,
    },
    {
      key: 'networks',
      name: t('about.networks'),
      licence: t('about.networksLicence'),
      text: networksLicence,
    },
    { key: 'inter', name: t('about.inter'), licence: t('about.ofl'), text: interOfl },
    { key: 'wenkai', name: t('about.wenkai'), licence: t('about.ofl'), text: wenkaiOfl },
    { key: 'others', name: t('about.others'), licence: t('about.othersLicence'), text: loadOthers },
  ];

  const show = (item: Item) => {
    if (typeof item.text === 'string') {
      setOpen({ title: item.name, text: item.text });
      return;
    }
    setOpen({ title: item.name, text: null });
    item.text().then(
      (text) =>
        setOpen((current) => (current?.title === item.name ? { ...current, text } : current)),
      () => setOpen(null),
    );
  };

  if (open) return <NoticeView title={open.title} text={open.text} onBack={() => setOpen(null)} />;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelTitle title={t('about.title')} onBack={toSettings} backLabel={t('settings.back')} />
      <div className="min-h-0 flex-1 overflow-y-auto pb-6">
        <VersionLine />
        <div className="space-y-1 px-6 text-[14px]">
          <p>{t('about.licence')}</p>
          <p className="flex items-center gap-1 text-text-muted">
            {t('about.source')}
            <Button
              variant="link"
              className="h-auto px-0 text-text"
              onClick={() => void openExternal(SOURCE_URL).catch(() => undefined)}
            >
              {SOURCE_LABEL}
            </Button>
          </p>
        </div>
        <h3 className="mt-8 px-6 text-[12px] text-text-muted">{t('about.thirdParty')}</h3>
        <ul className="mt-2 border-t border-hairline">
          {items.map((item) => (
            <li key={item.key} className="border-b border-hairline">
              <button
                type="button"
                className="flex w-full items-center gap-3 px-6 py-3 text-left text-[14px] hover:bg-divider-soft"
                onClick={() => show(item)}
              >
                <span className="flex-1">{item.name}</span>
                <span className="text-[13px] text-text-muted">{item.licence}</span>
                <ChevronRightIcon className="size-4 text-text-muted" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
