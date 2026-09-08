import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyTheme, parseTheme, THEME_PREFERENCES, type ThemeRoot } from './theme.ts';

/** Records what a real root element would have had done to it. */
function fakeRoot(): ThemeRoot & { theme: string | null } {
  return {
    theme: null,
    setAttribute(name: string, value: string) {
      assert.equal(name, 'data-theme');
      this.theme = value;
    },
    removeAttribute(name: string) {
      assert.equal(name, 'data-theme');
      this.theme = null;
    },
  };
}

describe('parseTheme', () => {
  it('keeps the two explicit choices', () => {
    assert.equal(parseTheme('light'), 'light');
    assert.equal(parseTheme('dark'), 'dark');
  });

  it('reads anything else as following the system', () => {
    for (const raw of [null, undefined, '', 'system', 'Dark', 'auto', 0, {}]) {
      assert.equal(parseTheme(raw), 'system');
    }
  });
});

describe('applyTheme', () => {
  it('marks the root with an explicit choice', () => {
    const root = fakeRoot();
    applyTheme('dark', root);
    assert.equal(root.theme, 'dark');
    applyTheme('light', root);
    assert.equal(root.theme, 'light');
  });

  it('leaves no attribute behind when the system decides', () => {
    const root = fakeRoot();
    applyTheme('dark', root);
    applyTheme('system', root);
    // The media query in styles.css only speaks while the attribute is absent,
    // so "system" has to clear it rather than name itself.
    assert.equal(root.theme, null);
  });

  it('handles every preference the control offers', () => {
    const root = fakeRoot();
    for (const preference of THEME_PREFERENCES) {
      applyTheme(preference, root);
      assert.equal(root.theme, preference === 'system' ? null : preference);
    }
  });
});
