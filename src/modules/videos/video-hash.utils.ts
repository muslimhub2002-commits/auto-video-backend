import { createHash } from 'crypto';

const sortUrlSearchParams = (value: URL) => {
  const sortedEntries = [...value.searchParams.entries()].sort(
    ([leftKey, leftValue], [rightKey, rightValue]) => {
      if (leftKey === rightKey) {
        return leftValue.localeCompare(rightValue);
      }
      return leftKey.localeCompare(rightKey);
    },
  );

  value.search = '';
  for (const [key, nextValue] of sortedEntries) {
    value.searchParams.append(key, nextValue);
  }
};

export const canonicalizeVideoUrl = (rawUrl: string): string => {
  const trimmed = String(rawUrl ?? '').trim();
  if (!trimmed) return '';

  if (trimmed.startsWith('/')) {
    return trimmed;
  }

  try {
    const normalized = new URL(trimmed);
    normalized.protocol = normalized.protocol.toLowerCase();
    normalized.hostname = normalized.hostname.toLowerCase();

    if (
      (normalized.protocol === 'https:' && normalized.port === '443') ||
      (normalized.protocol === 'http:' && normalized.port === '80')
    ) {
      normalized.port = '';
    }

    if (normalized.pathname !== '/' && normalized.pathname.endsWith('/')) {
      normalized.pathname = normalized.pathname.slice(0, -1);
    }

    sortUrlSearchParams(normalized);
    return normalized.toString();
  } catch {
    return trimmed;
  }
};

export const buildVideoUrlHash = (rawUrl: string): string => {
  return createHash('sha256')
    .update(`url:${canonicalizeVideoUrl(rawUrl)}`)
    .digest('hex');
};

export const buildVideoBufferHash = (buffer: Buffer): string => {
  return createHash('sha256').update(buffer).digest('hex');
};