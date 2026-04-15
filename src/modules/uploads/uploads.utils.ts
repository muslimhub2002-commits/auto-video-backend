import {
  UploadProviderName,
  UploadResourceType,
} from './uploads.types';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const UPLOADCARE_DIRECT_UPLOAD_MAX_BYTES = 100 * 1024 * 1024;

export const getUploadcareDirectUploadMaxBytes = () =>
  UPLOADCARE_DIRECT_UPLOAD_MAX_BYTES;

export const isHttpUrl = (value: string) => /^https?:\/\//i.test(value || '');

export const sanitizeUploadFolder = (value: string | null | undefined) => {
  const normalized = String(value ?? '')
    .replace(/\\+/g, '/')
    .trim()
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');

  return normalized || 'auto-video-generator/uploads';
};

export const ensureUploadFilename = (
  filename: string | null | undefined,
  fallback: string,
) => {
  const normalized = String(filename ?? '').trim();
  if (!normalized) return fallback;
  return normalized.replace(/[\\/:*?"<>|]+/g, '-');
};

export const buildProviderRef = (
  provider: UploadProviderName,
  rawRef: string | null | undefined,
) => {
  const normalized = String(rawRef ?? '').trim();
  if (!normalized) return null;
  return `${provider}:${normalized}`;
};

export const parseProviderRef = (providerRef: string | null | undefined) => {
  const normalized = String(providerRef ?? '').trim();
  if (!normalized) return null;

  const separatorIndex = normalized.indexOf(':');
  if (separatorIndex <= 0) return null;

  const provider = normalized.slice(0, separatorIndex) as UploadProviderName;
  const rawRef = normalized.slice(separatorIndex + 1).trim();
  if (!rawRef) return null;

  if (
    provider !== 'cloudinary' &&
    provider !== 'uploadcare' &&
    provider !== 'filestack' &&
    provider !== 'smash'
  ) {
    return null;
  }

  return { provider, rawRef };
};

export const resourceTypeToCloudinaryResourceType = (
  resourceType: UploadResourceType,
) => {
  return resourceType === 'image' ? 'image' : 'video';
};

export const extractFilestackHandleFromUrl = (url: string) => {
  try {
    const parsed = new URL(url);
    const lastSegment = String(parsed.pathname.split('/').pop() ?? '').trim();
    return lastSegment || null;
  } catch {
    return null;
  }
};

export const extractUploadcareUuid = (rawValue: string) => {
  try {
    const parsed = new URL(rawValue);
    const segments = parsed.pathname.split('/').filter(Boolean);
    const match = segments.find((segment) => UUID_REGEX.test(segment));
    return match ?? null;
  } catch {
    const match = String(rawValue ?? '').match(
      /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i,
    );
    return match?.[0] ?? null;
  }
};

export const isUploadcareUrl = (rawUrl: string) => {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();
    return (
      host === 'ucarecdn.com' ||
      host.endsWith('.ucarecdn.com') ||
      host === 'ucarecd.net' ||
      host.endsWith('.ucarecd.net')
    );
  } catch {
    return false;
  }
};

export const isCanonicalUploadcareUrl = (rawUrl: string) => {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();
    return host === 'ucarecd.net' || host.endsWith('.ucarecd.net');
  } catch {
    return false;
  }
};

export const getUploadcareCdnUrl = (uuid: string) => {
  return `https://ucarecdn.com/${uuid}/`;
};

export const findUuidInUnknownPayload = (payload: unknown): string | null => {
  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    return UUID_REGEX.test(trimmed) ? trimmed : null;
  }

  if (Array.isArray(payload)) {
    for (const item of payload) {
      const match = findUuidInUnknownPayload(item);
      if (match) return match;
    }
    return null;
  }

  if (!payload || typeof payload !== 'object') {
    return null;
  }

  for (const value of Object.values(payload)) {
    const match = findUuidInUnknownPayload(value);
    if (match) return match;
  }

  return null;
};

export const detectManagedUploadProvider = (
  rawUrl: string,
): UploadProviderName | null => {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();

    if (host === 'res.cloudinary.com') return 'cloudinary';
    if (
      host === 'ucarecdn.com' ||
      host.endsWith('.ucarecdn.com') ||
      host === 'ucarecd.net' ||
      host.endsWith('.ucarecd.net')
    ) {
      return 'uploadcare';
    }
    if (host === 'cdn.filestackcontent.com') return 'filestack';
    if (host === 'fromsmash.com' || host.endsWith('.fromsmash.com')) {
      return 'smash';
    }

    return null;
  } catch {
    return null;
  }
};

export const isManagedUploadUrl = (rawUrl: string) => {
  return detectManagedUploadProvider(rawUrl) !== null;
};

export const inferFilenameFromUrl = (
  rawUrl: string,
  fallback: string,
) => {
  try {
    const parsed = new URL(rawUrl);
    const fileName = String(parsed.pathname.split('/').pop() ?? '').trim();
    return ensureUploadFilename(fileName, fallback);
  } catch {
    return ensureUploadFilename('', fallback);
  }
};

export const sleep = async (ms: number) => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

export const deriveSmashRegionFromToken = (token: string | null | undefined) => {
  const rawToken = String(token ?? '').trim();
  if (!rawToken) return null;

  const parts = rawToken.split('.');
  if (parts.length < 2) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf8'),
    ) as { region?: string };
    const region = String(payload?.region ?? '').trim();
    return region || null;
  } catch {
    return null;
  }
};
