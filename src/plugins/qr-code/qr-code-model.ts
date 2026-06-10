import type { Options, DotType, CornerDotType, CornerSquareType, ErrorCorrectionLevel } from 'qr-code-styling';
import type { JsonObject } from '../../hvy/types';

export const QR_CODE_PLUGIN_DEFAULT_TEXT = 'https://example.invalid/qr-code';

export const QR_CODE_DOT_TYPES = ['square', 'dots', 'rounded', 'classy', 'classy-rounded', 'extra-rounded'] as const;
export const QR_CODE_CORNER_SQUARE_TYPES = ['square', 'dot', 'extra-rounded', 'dots', 'rounded', 'classy', 'classy-rounded'] as const;
export const QR_CODE_CORNER_DOT_TYPES = ['square', 'dot', 'dots', 'rounded', 'classy', 'classy-rounded', 'extra-rounded'] as const;
export const QR_CODE_ERROR_CORRECTION_LEVELS = ['L', 'M', 'Q', 'H'] as const;

export type QrCodeDotType = (typeof QR_CODE_DOT_TYPES)[number];
export type QrCodeCornerSquareType = (typeof QR_CODE_CORNER_SQUARE_TYPES)[number];
export type QrCodeCornerDotType = (typeof QR_CODE_CORNER_DOT_TYPES)[number];
export type QrCodeErrorCorrectionLevel = (typeof QR_CODE_ERROR_CORRECTION_LEVELS)[number];

export interface QrCodeConfig {
  caption: string;
  errorCorrectionLevel: QrCodeErrorCorrectionLevel;
  foregroundColor: string;
  backgroundColor: string;
  dotsType: QrCodeDotType;
  cornersSquareType: QrCodeCornerSquareType;
  cornersDotType: QrCodeCornerDotType;
}

export const DEFAULT_QR_CODE_CONFIG: QrCodeConfig = {
  caption: '',
  errorCorrectionLevel: 'Q',
  foregroundColor: '#111827',
  backgroundColor: '#ffffff',
  dotsType: 'rounded',
  cornersSquareType: 'extra-rounded',
  cornersDotType: 'dot',
};

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

export function readQrCodeConfig(raw: Record<string, unknown> | null | undefined): QrCodeConfig {
  return {
    caption: typeof raw?.caption === 'string' ? raw.caption : DEFAULT_QR_CODE_CONFIG.caption,
    errorCorrectionLevel: readOption(raw?.errorCorrectionLevel, QR_CODE_ERROR_CORRECTION_LEVELS, DEFAULT_QR_CODE_CONFIG.errorCorrectionLevel),
    foregroundColor: readColor(raw?.foregroundColor, DEFAULT_QR_CODE_CONFIG.foregroundColor),
    backgroundColor: readColor(raw?.backgroundColor, DEFAULT_QR_CODE_CONFIG.backgroundColor),
    dotsType: readOption(raw?.dotsType, QR_CODE_DOT_TYPES, DEFAULT_QR_CODE_CONFIG.dotsType),
    cornersSquareType: readOption(raw?.cornersSquareType, QR_CODE_CORNER_SQUARE_TYPES, DEFAULT_QR_CODE_CONFIG.cornersSquareType),
    cornersDotType: readOption(raw?.cornersDotType, QR_CODE_CORNER_DOT_TYPES, DEFAULT_QR_CODE_CONFIG.cornersDotType),
  };
}

function readOption<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && allowed.includes(value as T) ? value as T : fallback;
}

function readColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && HEX_COLOR_PATTERN.test(value.trim()) ? value.trim() : fallback;
}

export function createQrCodeStylingOptions(text: string, config: QrCodeConfig, size = 640): Partial<Options> {
  return {
    type: 'svg',
    width: size,
    height: size,
    margin: 24,
    data: text,
    qrOptions: {
      errorCorrectionLevel: config.errorCorrectionLevel as ErrorCorrectionLevel,
    },
    dotsOptions: {
      type: config.dotsType as DotType,
      color: config.foregroundColor,
      roundSize: true,
    },
    cornersSquareOptions: {
      type: config.cornersSquareType as CornerSquareType,
      color: config.foregroundColor,
    },
    cornersDotOptions: {
      type: config.cornersDotType as CornerDotType,
      color: config.foregroundColor,
    },
    backgroundOptions: {
      color: config.backgroundColor,
    },
  };
}

export function createQrCodePluginConfig(config: QrCodeConfig = DEFAULT_QR_CODE_CONFIG): JsonObject {
  return {
    caption: config.caption,
    errorCorrectionLevel: config.errorCorrectionLevel,
    foregroundColor: config.foregroundColor,
    backgroundColor: config.backgroundColor,
    dotsType: config.dotsType,
    cornersSquareType: config.cornersSquareType,
    cornersDotType: config.cornersDotType,
  };
}

export function createQrCodeStaticImageFilename(blockId: string): string {
  const safeId = blockId.trim().replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'qr-code';
  return `qr-code-${safeId}.svg`;
}
