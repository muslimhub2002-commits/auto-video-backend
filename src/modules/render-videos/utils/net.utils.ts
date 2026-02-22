export const downloadUrlToBuffer = async (params: {
  url: string;
  maxBytes: number;
  label: string;
}): Promise<{ buffer: Buffer; mimeType?: string }> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    let res: Response;
    try {
      res = await fetch(params.url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
      });
    } catch (err: any) {
      const reason =
        err?.name === 'AbortError'
          ? 'Request timed out'
          : typeof err?.message === 'string'
            ? err.message
            : String(err);
      throw new Error(
        `Failed to download ${params.label} from ${params.url}: ${reason}`,
      );
    }

    if (!res.ok) {
      throw new Error(
        `Failed to download ${params.label} (${res.status}): ${res.statusText}`,
      );
    }

    const contentLength = res.headers.get('content-length');
    if (contentLength) {
      const bytes = Number(contentLength);
      if (Number.isFinite(bytes) && bytes > params.maxBytes) {
        throw new Error(
          `Downloaded ${params.label} is too large (${bytes} bytes)`,
        );
      }
    }

    const arrayBuffer = await res.arrayBuffer();
    if (arrayBuffer.byteLength > params.maxBytes) {
      throw new Error(
        `Downloaded ${params.label} is too large (${arrayBuffer.byteLength} bytes)`,
      );
    }

    const mimeType = res.headers.get('content-type') ?? undefined;
    return { buffer: Buffer.from(arrayBuffer), mimeType };
  } finally {
    clearTimeout(timeout);
  }
};
