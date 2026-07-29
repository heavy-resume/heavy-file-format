import { expect, test } from 'vitest';

import {
  compileSurfaceResponsiveCss,
  getSurfaceBreakpoints,
} from '../src/surface-responsive-css';

test('expected result: compiles minimum and maximum variants against the HVY surface', () => {
  const expectedResult = compileSurfaceResponsiveCss(
    'padding: 1rem; md:order: 2; max-md:order: 1;',
    '.profile-photo',
    {}
  );

  expect(expectedResult.inlineCss).toBe('padding: 1rem');
  expect(expectedResult.responsiveRules).toContain(
    '@container hvy-surface (inline-size >= 48rem) { .profile-photo { order: 2; } }'
  );
  expect(expectedResult.responsiveRules).toContain(
    '@container hvy-surface (inline-size < 48rem) { .profile-photo { order: 1; } }'
  );
});

test('expected result: document metadata overrides defaults and adds breakpoints', () => {
  const expectedResult = getSurfaceBreakpoints({
    responsive_breakpoints: {
      md: '46rem',
      compact: '32rem',
      invalid: 'javascript:alert(1)',
    },
  });

  expect(expectedResult.md).toBe('46rem');
  expect(expectedResult.compact).toBe('32rem');
  expect(expectedResult.invalid).toBeUndefined();
  expect(expectedResult.lg).toBe('64rem');
});

test('expected result: responsive declarations use the inline CSS network sanitizer', () => {
  const expectedResult = compileSurfaceResponsiveCss(
    'md:background: url("https://example.com/tracker.png"); md:color: red;',
    '.safe',
    {}
  );

  expect(expectedResult.responsiveRules).not.toContain('url(');
  expect(expectedResult.responsiveRules).toContain('color: red;');
});
