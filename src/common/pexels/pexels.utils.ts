const PEXELS_API_BASE_URL = 'https://api.pexels.com';

type PexelsRequestParams = Record<string, string | number | null | undefined>;

const buildSearchUrl = (path: string, params: PexelsRequestParams) => {
  const url = new URL(path, PEXELS_API_BASE_URL);

  Object.entries(params).forEach(([key, value]) => {
    if (value === null || value === undefined) return;
    const normalized = String(value).trim();
    if (!normalized) return;
    url.searchParams.set(key, normalized);
  });

  return url.toString();
};

const pexelsFetch = async <T>(path: string, params: PexelsRequestParams) => {
  const apiKey = String(process.env.PEXELS_API_KEY ?? '').trim();
  if (!apiKey) {
    throw new Error('PEXELS_API_KEY is not configured');
  }

  const response = await fetch(buildSearchUrl(path, params), {
    method: 'GET',
    headers: {
      Authorization: apiKey,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `Pexels request failed (${response.status}): ${text || response.statusText}`,
    );
  }

  return (await response.json()) as T;
};

export type PexelsPhotoSearchResponse = {
  page?: number;
  per_page?: number;
  total_results?: number;
  photos?: Array<{
    id: number;
    width: number;
    height: number;
    url?: string;
    avg_color?: string;
    alt?: string;
    photographer?: string;
    photographer_url?: string;
    src?: {
      original?: string;
      large2x?: string;
      large?: string;
      medium?: string;
      small?: string;
      portrait?: string;
      landscape?: string;
      tiny?: string;
    };
  }>;
};

export type PexelsVideoSearchResponse = {
  page?: number;
  per_page?: number;
  total_results?: number;
  videos?: Array<{
    id: number;
    width: number;
    height: number;
    url?: string;
    image?: string;
    duration?: number;
    user?: {
      id?: number;
      name?: string;
      url?: string;
    };
    video_pictures?: Array<{
      id?: number;
      picture?: string;
      nr?: number;
    }>;
    video_files?: Array<{
      id?: number;
      quality?: string;
      file_type?: string;
      width?: number;
      height?: number;
      fps?: number;
      link?: string;
    }>;
  }>;
};

export const searchPexelsPhotos = (params: {
  query: string;
  page: number;
  perPage: number;
  orientation?: string | null;
  size?: string | null;
  color?: string | null;
}) => {
  return pexelsFetch<PexelsPhotoSearchResponse>('/v1/search', {
    query: params.query,
    page: params.page,
    per_page: params.perPage,
    orientation: params.orientation,
    size: params.size,
    color: params.color,
  });
};

export const browsePexelsPhotos = (params: {
  page: number;
  perPage: number;
}) => {
  return pexelsFetch<PexelsPhotoSearchResponse>('/v1/curated', {
    page: params.page,
    per_page: params.perPage,
  });
};

export const searchPexelsVideos = (params: {
  query: string;
  page: number;
  perPage: number;
  orientation?: string | null;
  size?: string | null;
}) => {
  return pexelsFetch<PexelsVideoSearchResponse>('/v1/videos/search', {
    query: params.query,
    page: params.page,
    per_page: params.perPage,
    orientation: params.orientation,
    size: params.size,
  });
};

export const browsePexelsVideos = (params: {
  page: number;
  perPage: number;
}) => {
  return pexelsFetch<PexelsVideoSearchResponse>('/v1/videos/popular', {
    page: params.page,
    per_page: params.perPage,
  });
};
