import css from './index.css?raw';

/** The declarations of the first rule whose selector list is exactly `selector`. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
  return css.match(new RegExp(`(?:^|[}\\s])${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
}

// M7 design 13.6: nothing in the window selects as text, including in WKWebView (prefixed).
it('makes nothing in the window selectable', () => {
  const body = rule('body');
  expect(body).toMatch(/(^|[\s;])user-select:\s*none/);
  expect(body).toMatch(/-webkit-user-select:\s*none/);
});

it('keeps text fields selectable', () => {
  const fields = rule('input,\n  textarea,\n  [contenteditable]');
  expect(fields).toMatch(/(^|[\s;])user-select:\s*text/);
  expect(fields).toMatch(/-webkit-user-select:\s*text/);
});
