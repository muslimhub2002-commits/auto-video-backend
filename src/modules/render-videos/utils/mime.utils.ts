import { extname } from 'path';

export const inferExt = (params: {
  originalName?: string;
  mimeType?: string;
  fallback: string;
}) => {
  const fromName = params.originalName ? extname(params.originalName) : '';
  if (fromName) return fromName;

  const mt = (params.mimeType ?? '').toLowerCase();
  if (mt.includes('png')) return '.png';
  if (mt.includes('jpeg') || mt.includes('jpg')) return '.jpg';
  if (mt.includes('webp')) return '.webp';
  if (mt.includes('gif')) return '.gif';
  if (mt.includes('mp3')) return '.mp3';
  if (mt.includes('wav')) return '.wav';
  if (mt.includes('mpeg')) return '.mp3';
  return params.fallback;
};
