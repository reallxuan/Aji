import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { usePlatformFiles } from '../platform/PlatformProvider';
import { useTransport } from '../transport/TransportProvider';
import type { ActionContext } from './actions';

/** What the game actions need, from the providers. */
export function useActionContext(): ActionContext {
  const transport = useTransport();
  const files = usePlatformFiles();
  const { t } = useTranslation();
  return useMemo(() => ({ transport, files, t }), [transport, files, t]);
}
