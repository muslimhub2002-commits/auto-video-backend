const MIN_DOWNLOAD_TIMEOUT_MS = 60_000;
const MAX_DOWNLOAD_TIMEOUT_MS = 30 * 60_000;
const ASSUMED_MIN_DOWNLOAD_BYTES_PER_SECOND = 256 * 1024;

const getDownloadFailureReason = (error: unknown, timeoutMs: number) => {
  if ((error as any)?.name === 'AbortError') {
    return `Request timed out after ${Math.ceil(timeoutMs / 1000)}s`;
  }

  if (typeof (error as any)?.message === 'string') {
    return (error as any).message;
  }

  return String(error);
};

const resolveDownloadTimeoutMs = (params: {
  maxBytes: number;
  timeoutMs?: number;
}) => {
  if (Number.isFinite(Number(params.timeoutMs)) && Number(params.timeoutMs) > 0) {
    return Number(params.timeoutMs);
  }

  const inferred =
    Math.ceil(params.maxBytes / ASSUMED_MIN_DOWNLOAD_BYTES_PER_SECOND) * 1000 +
    30_000;

  return Math.min(
    MAX_DOWNLOAD_TIMEOUT_MS,
    Math.max(MIN_DOWNLOAD_TIMEOUT_MS, inferred),
  );
};

export const downloadUrlToBuffer = async (params: {
  url: string;
  maxBytes: number;
  label: string;
  timeoutMs?: number;
}): Promise<{ buffer: Buffer; mimeType?: string }> => {
  const controller = new AbortController();
  const timeoutMs = resolveDownloadTimeoutMs(params);
  let timeout: NodeJS.Timeout | null = null;
  const resetTimeout = () => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => controller.abort(), timeoutMs);
  };

  resetTimeout();
  try {
    let res: Response;
    try {
      res = await fetch(params.url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
      });
    } catch (err: any) {
      const reason = getDownloadFailureReason(err, timeoutMs);
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

    const mimeType = res.headers.get('content-type') ?? undefined;

    if (!res.body || typeof res.body.getReader !== 'function') {
      let arrayBuffer: ArrayBuffer;
      try {
        resetTimeout();
        arrayBuffer = await res.arrayBuffer();
      } catch (err: any) {
        const reason = getDownloadFailureReason(err, timeoutMs);
        throw new Error(
          `Failed to read ${params.label} response body from ${params.url}: ${reason}`,
        );
      }

      if (arrayBuffer.byteLength > params.maxBytes) {
        throw new Error(
          `Downloaded ${params.label} is too large (${arrayBuffer.byteLength} bytes)`,
        );
      }

      return { buffer: Buffer.from(arrayBuffer), mimeType };
    }

    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    try {
      while (true) {
        let nextChunk: ReadableStreamReadResult<Uint8Array>;
        try {
          nextChunk = await reader.read();
        } catch (err: any) {
          const reason = getDownloadFailureReason(err, timeoutMs);
          throw new Error(
            `Failed to read ${params.label} response body from ${params.url}: ${reason}`,
          );
        }

        if (nextChunk.done) {
          break;
        }

        const value = nextChunk.value;
        if (!value || value.byteLength === 0) {
          resetTimeout();
          continue;
        }

        totalBytes += value.byteLength;
        if (totalBytes > params.maxBytes) {
          throw new Error(
            `Downloaded ${params.label} is too large (${totalBytes} bytes)`,
          );
        }

        chunks.push(value);
        resetTimeout();
      }
    } finally {
      reader.releaseLock();
    }

    return { buffer: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))), mimeType };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};
