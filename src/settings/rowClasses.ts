/**
 * A settings row: the label in a 144 px column beside its control, or above it when the
 * settings are narrower than 384 px (the phone's settings sheet, P2 M1 design 5.5). The settings
 * page is the `@container` these respond to.
 */
export const SETTINGS_ROW =
  'flex flex-col items-start gap-2 text-[14px] @sm:flex-row @sm:items-center @sm:gap-4';
export const SETTINGS_LABEL = 'shrink-0 @sm:w-36';
