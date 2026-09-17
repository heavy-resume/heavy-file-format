export function normalizeLinkInputValue(value: string): string {
  const trimmed = value.trim();
  if (/^mailto:/i.test(trimmed)) {
    return trimmed;
  }
  if (isEmailAddress(trimmed)) {
    return `mailto:${trimmed}`;
  }
  if (isWebAddressWithoutProtocol(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

export function isLinkInputValue(value: string): boolean {
  if (/^mailto:/i.test(value) || /^#/i.test(value)) {
    return true;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isEmailAddress(value: string): boolean {
  return /^[^\s:@<>()[\]]+@[^\s:@<>()[\]]+\.[^\s:@<>()[\]]+$/.test(value);
}

function isWebAddressWithoutProtocol(value: string): boolean {
  if (!value || /\s/.test(value) || /^[a-z][a-z\d+.-]*:/i.test(value)) {
    return false;
  }
  try {
    const url = new URL(`https://${value}`);
    return url.hostname.includes('.')
      && url.hostname.split('.').every((label) => /^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(label));
  } catch {
    return false;
  }
}

export function serializeMarkdownLinkDestination(href: string): string {
  return href
    .replace(/\s/g, (whitespace) => encodeURIComponent(whitespace))
    .replace(/([<>()])/g, '\\$1');
}
