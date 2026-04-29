import { createHash } from 'crypto';

const sortValueDeep = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => sortValueDeep(item));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.keys(value as Record<string, unknown>)
    .sort((left, right) => left.localeCompare(right))
    .reduce<Record<string, unknown>>((accumulator, key) => {
      const nextValue = (value as Record<string, unknown>)[key];
      if (nextValue !== undefined) {
        accumulator[key] = sortValueDeep(nextValue);
      }
      return accumulator;
    }, {});
};

export const stableSerializeValue = (value: unknown): string => {
  return JSON.stringify(sortValueDeep(value));
};

export const sha256Hex = (value: string | Buffer): string => {
  return createHash('sha256').update(value).digest('hex');
};