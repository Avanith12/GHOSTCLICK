// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { captchaPending } from './detectCaptcha';

describe('captchaPending', () => {
  it('is false on a normal page', () => {
    document.body.innerHTML = '<form><button>Go</button></form>';
    expect(captchaPending()).toBe(false);
  });
});
