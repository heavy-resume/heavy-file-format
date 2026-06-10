import { expect, test } from 'vitest';

import { getMatchingImagePresetCss, mergeImagePresetCss } from '../src/editor/components/image/image-preset-css';
import type { VisualBlock } from '../src/editor/types';
import { defaultBlockSchema } from '../src/document-factory';
import { configurePluginBlock } from '../src/plugins/plugin-block';
import { QR_CODE_PLUGIN_ID } from '../src/plugins/registry';
import {
  createQrCodePluginConfig,
  createQrCodeStaticImageFilename,
  createQrCodeStylingOptions,
  DEFAULT_QR_CODE_CONFIG,
  QR_CODE_DEFAULT_CSS,
  QR_CODE_IMAGE_PRESET_OVERRIDES,
  QR_CODE_PLUGIN_DEFAULT_TEXT,
  readQrCodeConfig,
} from '../src/plugins/qr-code/qr-code-model';
import { createDefaultTextCaption } from '../src/caption';

test('readQrCodeConfig defaults invalid style options', () => {
  const caption = createDefaultTextCaption('Scan me');
  const expectedResult = readQrCodeConfig({
    caption,
    foregroundColor: 'red',
    backgroundColor: '#f8fafc',
    dotsType: 'unknown',
    cornersSquareType: 'rounded',
    cornersDotType: 'nope',
  });

  expect(expectedResult).toEqual({
    ...DEFAULT_QR_CODE_CONFIG,
    caption,
    backgroundColor: '#f8fafc',
    cornersSquareType: 'rounded',
  });
});

test('readQrCodeConfig migrates string captions to styled caption payloads', () => {
  const expectedResult = readQrCodeConfig({
    caption: 'Scan me',
  });

  expect(expectedResult.caption?.text).toBe('Scan me');
  expect(expectedResult.caption?.schema.align).toBe('center');
});

test('createQrCodeStylingOptions maps plugin config to styled SVG options', () => {
  const expectedResult = createQrCodeStylingOptions('https://example.invalid/qr', {
    ...DEFAULT_QR_CODE_CONFIG,
    foregroundColor: '#0f172a',
    backgroundColor: '#ffffff',
    dotsType: 'classy-rounded',
    cornersSquareType: 'extra-rounded',
    cornersDotType: 'dot',
  }, 512);

  expect(expectedResult).toMatchObject({
    type: 'svg',
    width: 512,
    height: 512,
    margin: 24,
    data: 'https://example.invalid/qr',
    qrOptions: { errorCorrectionLevel: 'H' },
    dotsOptions: { type: 'classy-rounded', color: '#0f172a' },
    cornersSquareOptions: { type: 'extra-rounded', color: '#0f172a' },
    cornersDotOptions: { type: 'dot', color: '#0f172a' },
    backgroundOptions: { color: '#ffffff' },
  });
});

test('createQrCodeStylingOptions allows static PDF export to remove internal margin', () => {
  const expectedResult = createQrCodeStylingOptions('https://example.invalid/qr', DEFAULT_QR_CODE_CONFIG, 640, 'H', 0);

  expect(expectedResult.margin).toBe(0);
});

test('error correction defaults to highest quality level', () => {
  const expectedResult = createQrCodeStylingOptions('https://example.invalid/qr', DEFAULT_QR_CODE_CONFIG);

  expect(expectedResult.qrOptions).toEqual({ errorCorrectionLevel: 'H' });
});

test('configurePluginBlock seeds QR code plugin config and body text', () => {
  const block: VisualBlock = {
    id: 'qr-code',
    text: '',
    schema: defaultBlockSchema('text'),
    schemaMode: false,
  };

  configurePluginBlock(block, QR_CODE_PLUGIN_ID);

  expect(block.schema.component).toBe('plugin');
  expect(block.schema.plugin).toBe(QR_CODE_PLUGIN_ID);
  expect(block.schema.pluginConfig).toEqual(createQrCodePluginConfig());
  expect(block.text).toBe(QR_CODE_PLUGIN_DEFAULT_TEXT);
  expect(block.schema.css).toBe(QR_CODE_DEFAULT_CSS);
});

test('QR code size presets use reduced small and medium widths', () => {
  const smallResult = mergeImagePresetCss(
    'margin: 0.5rem auto; display: block; width: 40rem; height: auto;',
    'small',
    QR_CODE_IMAGE_PRESET_OVERRIDES
  );
  const mediumResult = mergeImagePresetCss(
    'margin: 0.5rem auto; display: block; width: 15rem; height: auto;',
    'medium',
    QR_CODE_IMAGE_PRESET_OVERRIDES
  );

  expect(smallResult).toContain('width: 15rem');
  expect(mediumResult).toContain('width: 22.5rem');
  expect(getMatchingImagePresetCss(QR_CODE_DEFAULT_CSS, ['small', 'medium'], QR_CODE_IMAGE_PRESET_OVERRIDES)).toBe('small');
});

test('createQrCodeStaticImageFilename keeps attachment names stable and safe', () => {
  expect(createQrCodeStaticImageFilename('contact-card')).toBe('qr-code-contact-card.svg');
  expect(createQrCodeStaticImageFilename('Contact Card!')).toBe('qr-code-Contact-Card.svg');
  expect(createQrCodeStaticImageFilename('')).toBe('qr-code-qr-code.svg');
});
