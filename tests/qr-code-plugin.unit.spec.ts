import { expect, test } from 'vitest';

import type { VisualBlock } from '../src/editor/types';
import { defaultBlockSchema } from '../src/document-factory';
import { configurePluginBlock } from '../src/plugins/plugin-block';
import { QR_CODE_PLUGIN_ID } from '../src/plugins/registry';
import {
  createQrCodePluginConfig,
  createQrCodeStaticImageFilename,
  createQrCodeStylingOptions,
  DEFAULT_QR_CODE_CONFIG,
  QR_CODE_PLUGIN_DEFAULT_TEXT,
  readQrCodeConfig,
} from '../src/plugins/qr-code/qr-code-model';

test('readQrCodeConfig defaults invalid style options', () => {
  const expectedResult = readQrCodeConfig({
    caption: 'Scan me',
    errorCorrectionLevel: 'bad',
    foregroundColor: 'red',
    backgroundColor: '#f8fafc',
    dotsType: 'unknown',
    cornersSquareType: 'rounded',
    cornersDotType: 'nope',
  });

  expect(expectedResult).toEqual({
    ...DEFAULT_QR_CODE_CONFIG,
    caption: 'Scan me',
    backgroundColor: '#f8fafc',
    cornersSquareType: 'rounded',
  });
});

test('createQrCodeStylingOptions maps plugin config to styled SVG options', () => {
  const expectedResult = createQrCodeStylingOptions('https://example.invalid/qr', {
    ...DEFAULT_QR_CODE_CONFIG,
    errorCorrectionLevel: 'H',
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
    data: 'https://example.invalid/qr',
    qrOptions: { errorCorrectionLevel: 'H' },
    dotsOptions: { type: 'classy-rounded', color: '#0f172a' },
    cornersSquareOptions: { type: 'extra-rounded', color: '#0f172a' },
    cornersDotOptions: { type: 'dot', color: '#0f172a' },
    backgroundOptions: { color: '#ffffff' },
  });
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
  expect(block.schema.css).toBe('margin: 0.5rem auto; display: block; width: 20rem; height: auto;');
});

test('createQrCodeStaticImageFilename keeps attachment names stable and safe', () => {
  expect(createQrCodeStaticImageFilename('contact-card')).toBe('qr-code-contact-card.svg');
  expect(createQrCodeStaticImageFilename('Contact Card!')).toBe('qr-code-Contact-Card.svg');
  expect(createQrCodeStaticImageFilename('')).toBe('qr-code-qr-code.svg');
});
