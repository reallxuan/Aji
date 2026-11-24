import { afterEach, expect, it } from 'vitest';
import { busy } from './busy';

afterEach(() => {
  document.body.innerHTML = '';
});

/** A Radix popper as the portal mounts it: a wrapper around the content. */
function popper(slot: string) {
  const wrapper = document.createElement('div');
  wrapper.setAttribute('data-radix-popper-content-wrapper', '');
  const content = document.createElement('div');
  content.setAttribute('data-slot', slot);
  wrapper.append(content);
  document.body.append(wrapper);
}

it('an open menu keeps the keys', () => {
  popper('dropdown-menu-content');
  expect(busy(document.body)).toBe(true);
});

it('an open engine card does not: it only shows, and takes no keys', () => {
  popper('hover-card-content');
  expect(busy(document.body)).toBe(false);
});

it('a menu open beside a card still keeps the keys', () => {
  popper('hover-card-content');
  popper('dropdown-menu-content');
  expect(busy(document.body)).toBe(true);
});

it('retains the keyboard inside a nested contenteditable and when a modal is open', () => {
  const editor = document.createElement('div');
  editor.setAttribute('contenteditable', 'plaintext-only');
  const text = document.createElement('span');
  editor.append(text);
  document.body.append(editor);
  expect(busy(text)).toBe(true);
  editor.remove();
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  document.body.append(dialog);
  expect(busy(document.body)).toBe(true);
});
