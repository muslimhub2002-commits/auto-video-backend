export type SoundEffectEqSettings = {
  lowGainDb: number;
  midGainDb: number;
  highGainDb: number;
  lowFrequencyHz: number;
  midFrequencyHz: number;
  highFrequencyHz: number;
  midQ: number;
};

export type SoundEffectCompressorSettings = {
  enabled: boolean;
  threshold: number;
  ratio: number;
  attack: number;
  release: number;
  knee: number;
};

export type SoundEffectReverbSettings = {
  enabled: boolean;
  mix: number;
  duration: number;
  decay: number;
};

export type SoundEffectEchoSettings = {
  enabled: boolean;
  mix: number;
  delayMs: number;
  feedback: number;
};

export type SoundEffectSaturationSettings = {
  enabled: boolean;
  drive: number;
  mix: number;
};

export type SoundEffectTrimSettings = {
  startSeconds: number;
  durationSeconds: number;
};

export type SoundEffectAudioSettings = {
  version: 1;
  eq: SoundEffectEqSettings;
  compressor: SoundEffectCompressorSettings;
  reverb: SoundEffectReverbSettings;
  echo: SoundEffectEchoSettings;
  saturation: SoundEffectSaturationSettings;
  trim: SoundEffectTrimSettings;
};

const clamp = (value: unknown, min: number, max: number, fallback: number) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
};

const clampBoolean = (value: unknown, fallback: boolean) => {
  if (typeof value === 'boolean') return value;
  return fallback;
};

export const DEFAULT_SOUND_EFFECT_AUDIO_SETTINGS: SoundEffectAudioSettings = {
  version: 1,
  eq: {
    lowGainDb: 0,
    midGainDb: 0,
    highGainDb: 0,
    lowFrequencyHz: 200,
    midFrequencyHz: 1000,
    highFrequencyHz: 5000,
    midQ: 1,
  },
  compressor: {
    enabled: false,
    threshold: -24,
    ratio: 3,
    attack: 0.003,
    release: 0.25,
    knee: 30,
  },
  reverb: {
    enabled: false,
    mix: 0.18,
    duration: 1.8,
    decay: 2.2,
  },
  echo: {
    enabled: false,
    mix: 0.22,
    delayMs: 180,
    feedback: 0.28,
  },
  saturation: {
    enabled: false,
    drive: 1.4,
    mix: 0.2,
  },
  trim: {
    startSeconds: 0,
    durationSeconds: 0,
  },
};

export const normalizeSoundEffectAudioSettings = (
  value: unknown,
): SoundEffectAudioSettings => {
  const raw =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const eq =
    raw.eq && typeof raw.eq === 'object' && !Array.isArray(raw.eq)
      ? (raw.eq as Record<string, unknown>)
      : {};
  const compressor =
    raw.compressor &&
    typeof raw.compressor === 'object' &&
    !Array.isArray(raw.compressor)
      ? (raw.compressor as Record<string, unknown>)
      : {};
  const reverb =
    raw.reverb && typeof raw.reverb === 'object' && !Array.isArray(raw.reverb)
      ? (raw.reverb as Record<string, unknown>)
      : {};
  const echo =
    raw.echo && typeof raw.echo === 'object' && !Array.isArray(raw.echo)
      ? (raw.echo as Record<string, unknown>)
      : {};
  const saturation =
    raw.saturation &&
    typeof raw.saturation === 'object' &&
    !Array.isArray(raw.saturation)
      ? (raw.saturation as Record<string, unknown>)
      : {};
  const trim =
    raw.trim && typeof raw.trim === 'object' && !Array.isArray(raw.trim)
      ? (raw.trim as Record<string, unknown>)
      : {};

  return {
    version: 1,
    eq: {
      lowGainDb: clamp(
        eq.lowGainDb,
        -24,
        24,
        DEFAULT_SOUND_EFFECT_AUDIO_SETTINGS.eq.lowGainDb,
      ),
      midGainDb: clamp(
        eq.midGainDb,
        -24,
        24,
        DEFAULT_SOUND_EFFECT_AUDIO_SETTINGS.eq.midGainDb,
      ),
      highGainDb: clamp(
        eq.highGainDb,
        -24,
        24,
        DEFAULT_SOUND_EFFECT_AUDIO_SETTINGS.eq.highGainDb,
      ),
      lowFrequencyHz: clamp(
        eq.lowFrequencyHz,
        40,
        600,
        DEFAULT_SOUND_EFFECT_AUDIO_SETTINGS.eq.lowFrequencyHz,
      ),
      midFrequencyHz: clamp(
        eq.midFrequencyHz,
        300,
        4000,
        DEFAULT_SOUND_EFFECT_AUDIO_SETTINGS.eq.midFrequencyHz,
      ),
      highFrequencyHz: clamp(
        eq.highFrequencyHz,
        2000,
        12000,
        DEFAULT_SOUND_EFFECT_AUDIO_SETTINGS.eq.highFrequencyHz,
      ),
      midQ: clamp(
        eq.midQ,
        0.1,
        10,
        DEFAULT_SOUND_EFFECT_AUDIO_SETTINGS.eq.midQ,
      ),
    },
    compressor: {
      enabled: clampBoolean(
        compressor.enabled,
        DEFAULT_SOUND_EFFECT_AUDIO_SETTINGS.compressor.enabled,
      ),
      threshold: clamp(
        compressor.threshold,
        -100,
        0,
        DEFAULT_SOUND_EFFECT_AUDIO_SETTINGS.compressor.threshold,
      ),
      ratio: clamp(
        compressor.ratio,
        1,
        20,
        DEFAULT_SOUND_EFFECT_AUDIO_SETTINGS.compressor.ratio,
      ),
      attack: clamp(
        compressor.attack,
        0,
        1,
        DEFAULT_SOUND_EFFECT_AUDIO_SETTINGS.compressor.attack,
      ),
      release: clamp(
        compressor.release,
        0,
        2,
        DEFAULT_SOUND_EFFECT_AUDIO_SETTINGS.compressor.release,
      ),
      knee: clamp(
        compressor.knee,
        0,
        40,
        DEFAULT_SOUND_EFFECT_AUDIO_SETTINGS.compressor.knee,
      ),
    },
    reverb: {
      enabled: clampBoolean(
        reverb.enabled,
        DEFAULT_SOUND_EFFECT_AUDIO_SETTINGS.reverb.enabled,
      ),
      mix: clamp(
        reverb.mix,
        0,
        1,
        DEFAULT_SOUND_EFFECT_AUDIO_SETTINGS.reverb.mix,
      ),
      duration: clamp(
        reverb.duration,
        0.1,
        8,
        DEFAULT_SOUND_EFFECT_AUDIO_SETTINGS.reverb.duration,
      ),
      decay: clamp(
        reverb.decay,
        0.1,
        8,
        DEFAULT_SOUND_EFFECT_AUDIO_SETTINGS.reverb.decay,
      ),
    },
    echo: {
      enabled: clampBoolean(
        echo.enabled,
        DEFAULT_SOUND_EFFECT_AUDIO_SETTINGS.echo.enabled,
      ),
      mix: clamp(echo.mix, 0, 1, DEFAULT_SOUND_EFFECT_AUDIO_SETTINGS.echo.mix),
      delayMs: clamp(
        echo.delayMs,
        20,
        2000,
        DEFAULT_SOUND_EFFECT_AUDIO_SETTINGS.echo.delayMs,
      ),
      feedback: clamp(
        echo.feedback,
        0,
        0.95,
        DEFAULT_SOUND_EFFECT_AUDIO_SETTINGS.echo.feedback,
      ),
    },
    saturation: {
      enabled: clampBoolean(
        saturation.enabled,
        DEFAULT_SOUND_EFFECT_AUDIO_SETTINGS.saturation.enabled,
      ),
      drive: clamp(
        saturation.drive,
        1,
        10,
        DEFAULT_SOUND_EFFECT_AUDIO_SETTINGS.saturation.drive,
      ),
      mix: clamp(
        saturation.mix,
        0,
        1,
        DEFAULT_SOUND_EFFECT_AUDIO_SETTINGS.saturation.mix,
      ),
    },
    trim: {
      startSeconds: clamp(
        trim.startSeconds,
        0,
        600,
        DEFAULT_SOUND_EFFECT_AUDIO_SETTINGS.trim.startSeconds,
      ),
      durationSeconds: clamp(
        trim.durationSeconds,
        0,
        600,
        DEFAULT_SOUND_EFFECT_AUDIO_SETTINGS.trim.durationSeconds,
      ),
    },
  };
};
