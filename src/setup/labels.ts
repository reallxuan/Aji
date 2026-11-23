import type { TFunction } from 'i18next';
import type { Backend } from '../transport/generated/Backend';
import type { BackendTag } from '../transport/generated/BackendTag';
import type { GpuReport } from '../transport/generated/GpuReport';
import type { HardwareReport } from '../transport/generated/HardwareReport';
import type { Platform } from '../transport/generated/Platform';

export const backendName = (t: TFunction, backend: Backend) => t(`setup.backend.names.${backend}`);

/** `mostCompatible` and `slowest` read as one phrase; other tags are listed as they come. */
export function tagText(t: TFunction, tags: BackendTag[]): string {
  const combined = tags.includes('mostCompatible') && tags.includes('slowest');
  const words = combined
    ? [
        t('setup.backend.tags.mostCompatibleSlowest'),
        ...tags
          .filter((tag) => tag !== 'mostCompatible' && tag !== 'slowest')
          .map((tag) => t(`setup.backend.tags.${tag}`)),
      ]
    : tags.map((tag) => t(`setup.backend.tags.${tag}`));
  return words.join(t('separator'));
}

/** The card detection reports first: a real GPU before a software renderer. */
export function mainGpu(hardware: HardwareReport | null): GpuReport | null {
  if (!hardware) return null;
  return hardware.gpus.find((gpu) => !gpu.software) ?? hardware.gpus[0] ?? null;
}

const ARCH: Record<string, string> = { x86_64: 'x64', amd64: 'x64', aarch64: 'arm64' };

export const archLabel = (arch: string) => ARCH[arch] ?? arch;

/** "Windows x64" from a manifest platform. */
export function platformLabel(t: TFunction, platform: Platform): string {
  const [os, arch] = platform.split('-');
  return `${t(`os.${os}`)} ${arch}`;
}
