import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getAppInfo } from '../transport/api';
import type { AppInfo } from '../transport/generated/AppInfo';
import type { ErrorCode } from '../transport/generated/ErrorCode';
import { toTransportError } from '../transport/transport';
import { useTransport } from '../transport/TransportProvider';

type State =
  { status: 'loading' } | { status: 'ok'; info: AppInfo } | { status: 'error'; code: ErrorCode };

/** "Aji version 0.1.0 (macOS aarch64)", fetched from the Rust side through the transport. */
export function VersionLine() {
  const transport = useTransport();
  const { t } = useTranslation();
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    getAppInfo(transport).then(
      (info) => {
        if (active) setState({ status: 'ok', info });
      },
      (error: unknown) => {
        if (active) setState({ status: 'error', code: toTransportError(error).code });
      },
    );
    return () => {
      active = false;
    };
  }, [transport]);

  if (state.status === 'loading') return null;
  const text =
    state.status === 'ok'
      ? t('about.versionLine', {
          version: state.info.version,
          os: t(`os.${state.info.os}`),
          arch: state.info.arch,
        })
      : t(`errors.${state.code}`);
  return <p className="px-6 py-4 text-xs text-text-muted">{text}</p>;
}
