/**
 * A settings row: the label in a 9rem column beside its control, or above it when the settings
 * are narrower than 28rem (448 px at 100%): the phone's settings sheet (P2 M1 design 5.5), or a
 * column too narrow for a scaled-up interface. The settings page is the `@container` these
 * respond to.
 */
export const SETTINGS_ROW =
  'flex flex-col items-start gap-2 text-[0.875rem] @md:flex-row @md:items-center @md:gap-4';
export const SETTINGS_LABEL = 'shrink-0 @md:w-36';
