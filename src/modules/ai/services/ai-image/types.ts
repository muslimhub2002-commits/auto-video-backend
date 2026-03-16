export type CharacterGender = 'male' | 'female' | 'unknown';

export type CharacterProfile = {
  key: string;
  name: string;
  gender: CharacterGender;
  description: string;
};

export type CharacterBible = {
  characters: CharacterProfile[];
  byKey: Record<string, CharacterProfile>;
};

export type ScriptLocationCacheEntry = {
  expiresAt: number;
  location: string | null;
};

export type ImagePayload = {
  buffer: Buffer;
  base64: string;
};
