const PIXABAY_API_BASE_URL = 'https://pixabay.com';

type PixabayRequestParams = Record<string, string | number | null | undefined>;

const buildSearchUrl = (path: string, params: PixabayRequestParams) => {
  const url = new URL(path, PIXABAY_API_BASE_URL);

  Object.entries(params).forEach(([key, value]) => {
    if (value === null || value === undefined) return;
    const normalized = String(value).trim();
    if (!normalized) return;
    url.searchParams.set(key, normalized);
  });

  return url.toString();
};

const pixabayFetch = async <T>(path: string, params: PixabayRequestParams) => {
  const apiKey = String(process.env.PIXABAY_API_KEY ?? '').trim();
  if (!apiKey) {
    throw new Error('PIXABAY_API_KEY is not configured');
  }

  const response = await fetch(
    buildSearchUrl(path, {
      key: apiKey,
      ...params,
    }),
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    },
  );

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `Pixabay request failed (${response.status}): ${text || response.statusText}`,
    );
  }

  return (await response.json()) as T;
};

export type PixabayImageSearchResponse = {
  total?: number;
  totalHits?: number;
  hits?: Array<{
    id: number;
    pageURL?: string;
    type?: string;
    tags?: string;
    previewURL?: string;
    previewWidth?: number;
    previewHeight?: number;
    webformatURL?: string;
    webformatWidth?: number;
    webformatHeight?: number;
    largeImageURL?: string;
    fullHDURL?: string;
    imageURL?: string;
    imageWidth?: number;
    imageHeight?: number;
    imageSize?: number;
    views?: number;
    downloads?: number;
    likes?: number;
    comments?: number;
    user_id?: number;
    user?: string;
    userImageURL?: string;
  }>;
};

export type PixabayVideoSearchResponse = {
  total?: number;
  totalHits?: number;
  hits?: Array<{
    id: number;
    pageURL?: string;
    type?: string;
    tags?: string;
    duration?: number;
    videos?: {
      large?: PixabayVideoFile;
      medium?: PixabayVideoFile;
      small?: PixabayVideoFile;
      tiny?: PixabayVideoFile;
    };
    views?: number;
    downloads?: number;
    likes?: number;
    comments?: number;
    user_id?: number;
    user?: string;
    userImageURL?: string;
  }>;
};

export type PixabayVideoFile = {
  url?: string;
  width?: number;
  height?: number;
  size?: number;
  thumbnail?: string;
};

export const searchPixabayImages = (params: {
  query?: string | null;
  page: number;
  perPage: number;
  orientation?: string | null;
  colors?: string | null;
}) => {
  return pixabayFetch<PixabayImageSearchResponse>('/api/', {
    q: params.query,
    page: params.page,
    per_page: params.perPage,
    image_type: 'photo',
    orientation: params.orientation,
    colors: params.colors,
    safesearch: 'true',
    order: 'popular',
  });
};

export const browsePixabayImages = (params: {
  page: number;
  perPage: number;
  orientation?: string | null;
  colors?: string | null;
}) => {
  return searchPixabayImages({
    query: null,
    page: params.page,
    perPage: params.perPage,
    orientation: params.orientation,
    colors: params.colors,
  });
};

export const searchPixabayVideos = (params: {
  query?: string | null;
  page: number;
  perPage: number;
}) => {
  return pixabayFetch<PixabayVideoSearchResponse>('/api/videos/', {
    q: params.query,
    page: params.page,
    per_page: params.perPage,
    safesearch: 'true',
    order: 'popular',
  });
};

export const browsePixabayVideos = (params: {
  page: number;
  perPage: number;
}) => {
  return searchPixabayVideos({
    query: null,
    page: params.page,
    perPage: params.perPage,
  });
};