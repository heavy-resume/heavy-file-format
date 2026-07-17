export interface DocumentMetadataValidationIssue {
  path: string;
  message: string;
}

export function validateDocumentMetadata(value: unknown): DocumentMetadataValidationIssue | null {
  if (!isObject(value)) {
    return {
      path: 'metadata',
      message: 'metadata must be an object.',
    };
  }

  for (const [key, entry] of Object.entries(value)) {
    if (Array.isArray(entry)) {
      return unsupportedValue(`metadata.${key}`);
    }
    if (!isObject(entry)) {
      continue;
    }
    for (const [nestedKey, nestedEntry] of Object.entries(entry)) {
      if (isObject(nestedEntry) || Array.isArray(nestedEntry)) {
        return {
          path: `metadata.${key}.${nestedKey}`,
          message: `metadata.${key}.${nestedKey} exceeds the two-object-level nesting limit.`,
        };
      }
    }
  }

  return null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function unsupportedValue(path: string): DocumentMetadataValidationIssue {
  return {
    path,
    message: `${path} must be a scalar or object; arrays are not supported in metadata.`,
  };
}
