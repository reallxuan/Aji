import type { ReactNode } from 'react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
export type Layout = 'popover' | 'settings';

/** Short muted labels in the popover; the settings page's wide label column elsewhere. */
const FIELD = {
  popover: {
    row: 'flex-wrap gap-x-3 gap-y-1 text-[0.84375rem]',
    label: 'min-w-14 text-text-muted',
  },
  settings: { row: 'gap-x-4 gap-y-2 text-[0.875rem] flex-wrap', label: 'w-36' },
} as const;

export function Field({
  label,
  layout,
  children,
}: {
  label: string;
  layout: Layout;
  children: ReactNode;
}) {
  return (
    <div className={`flex min-h-8 items-center ${FIELD[layout].row}`}>
      <span className={`flex-none ${FIELD[layout].label}`}>{label}</span>
      {children}
    </div>
  );
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<[T, string]>;
  onChange(value: T): void;
}) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      aria-label={label}
      value={value}
      // Clicking the chosen item again would clear it; the rules always have a value.
      onValueChange={(next) => next && next !== value && onChange(next as T)}
    >
      {options.map(([option, text]) => (
        <ToggleGroupItem key={option} value={option} className="px-3 whitespace-nowrap">
          {text}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
