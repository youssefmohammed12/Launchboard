import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

/*
 * Node 26 exposes an experimental `localStorage` global that is undefined
 * unless the process is started with --localstorage-file. Vitest's jsdom
 * bridge can skip copying window keys that already exist on the Node global, so
 * `window.localStorage` resolves to Node's undefined value even though jsdom
 * created a working Storage object. Re-expose the jsdom storage explicitly.
 */
type JsdomGlobal = typeof globalThis & {
  jsdom?: { window: Window };
};

const jsdomStorage = (globalThis as JsdomGlobal).jsdom?.window.localStorage;

if (jsdomStorage) {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: jsdomStorage,
  });
}

/*
 * jsdom implements <dialog> partially. The application relies on the browser's
 * native showModal()/close() behavior, which is covered end-to-end by
 * focus-test.cjs. These small shims only let component tests render dialogs.
 */
if (typeof HTMLDialogElement !== 'undefined') {
  if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      configurable: true,
      writable: true,
      value(this: HTMLDialogElement) {
        this.open = true;
      },
    });
  }

  if (typeof HTMLDialogElement.prototype.close !== 'function') {
    Object.defineProperty(HTMLDialogElement.prototype, 'close', {
      configurable: true,
      writable: true,
      value(this: HTMLDialogElement) {
        this.open = false;
        this.dispatchEvent(new Event('close'));
      },
    });
  }
}

function escapeCssIdentifier(value: string): string {
  return value.replace(/([^a-zA-Z0-9_-])/g, '\\$1');
}

if (typeof globalThis.CSS === 'undefined') {
  Object.defineProperty(globalThis, 'CSS', {
    configurable: true,
    value: { escape: escapeCssIdentifier },
  });
} else if (typeof globalThis.CSS.escape !== 'function') {
  Object.defineProperty(globalThis.CSS, 'escape', {
    configurable: true,
    value: escapeCssIdentifier,
  });
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
});
