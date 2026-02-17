import { InternalServerErrorException } from '@nestjs/common';

export const isLikelyImageBuffer = (buf: Buffer): boolean => {
  if (!buf || buf.length < 12) return false;

  // PNG
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return true;
  }

  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;

  // GIF
  if (
    buf[0] === 0x47 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x38 &&
    (buf[4] === 0x37 || buf[4] === 0x39) &&
    buf[5] === 0x61
  ) {
    return true;
  }

  // WEBP
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return true;
  }

  // ISO Base Media (AVIF/HEIC)
  if (
    buf.length >= 12 &&
    buf[4] === 0x66 &&
    buf[5] === 0x74 &&
    buf[6] === 0x79 &&
    buf[7] === 0x70
  ) {
    const brand = buf.slice(8, 12).toString('ascii');
    if (
      ['avif', 'avis', 'mif1', 'msf1', 'heic', 'heix', 'hevc', 'hevx'].includes(
        brand,
      )
    ) {
      return true;
    }
  }

  // BMP
  if (buf[0] === 0x42 && buf[1] === 0x4d) return true;

  return false;
};

export const normalizeBase64Image = (
  raw: string,
): { base64: string; buffer: Buffer } => {
  const noDataUri = String(raw ?? '').replace(
    /^data:image\/[a-zA-Z0-9.+-]+;base64,/,
    '',
  );
  let normalized = noDataUri.replace(/\s+/g, '');
  normalized = normalized.replace(/-/g, '+').replace(/_/g, '/');

  const remainder = normalized.length % 4;
  if (remainder === 2) normalized += '==';
  else if (remainder === 3) normalized += '=';

  const buffer = Buffer.from(normalized, 'base64');
  return { base64: normalized, buffer };
};

export const downloadImageToBuffer = async (
  url: string,
  label: string,
): Promise<Buffer> => {
  const imgResp = await fetch(url, { method: 'GET' } as any);
  const contentType = String(
    imgResp.headers?.get?.('content-type') ?? '',
  ).toLowerCase();

  if (!imgResp.ok) {
    const errorText = await imgResp.text().catch(() => '');
    console.error(`${label} image download failed`, {
      status: imgResp.status,
      statusText: imgResp.statusText,
      body: errorText,
      url,
      contentType: contentType || undefined,
    });
    throw new InternalServerErrorException(
      `Failed to download ${label} generated image`,
    );
  }

  if (
    contentType &&
    (contentType.includes('text/html') ||
      contentType.includes('application/json') ||
      contentType.startsWith('text/'))
  ) {
    const bodyText = await imgResp.text().catch(() => '');
    console.error(`${label} image URL did not return an image`, {
      url,
      contentType,
      bodySnippet: bodyText.slice(0, 300),
    });
    throw new InternalServerErrorException(
      `${label} returned an invalid image URL payload`,
    );
  }

  return Buffer.from(await imgResp.arrayBuffer());
};
