import { describe, expect, it } from '@jest/globals';
import {
  buildMergedSoundEffectsFilterGraph,
  resolveMergeSoundEffectRenderItem,
} from './sound-effects.service';

describe('sound effects merge filter graph', () => {
  it('builds a filter graph that includes per-item audio effects and delay', () => {
    const resolved = resolveMergeSoundEffectRenderItem({
      item: {
        sound_effect_id: '11111111-1111-1111-1111-111111111111',
        delay_seconds: 1.25,
        volume_percent: 140,
        trim_start_seconds: 0.4,
        duration_seconds: 2.2,
        audio_settings_override: {
          eq: {
            lowGainDb: 3,
            midGainDb: -2,
            highGainDb: 4,
            lowFrequencyHz: 180,
            midFrequencyHz: 1200,
            highFrequencyHz: 6400,
            midQ: 1.8,
          },
          compressor: {
            enabled: true,
            threshold: -18,
            ratio: 4,
            attack: 0.01,
            release: 0.4,
            knee: 20,
          },
          echo: {
            enabled: true,
            mix: 0.3,
            delayMs: 180,
            feedback: 0.35,
          },
          reverb: {
            enabled: true,
            mix: 0.22,
            duration: 1.6,
            decay: 2.4,
          },
          saturation: {
            enabled: true,
            drive: 2.5,
            mix: 0.25,
          },
          trim: {
            startSeconds: 0.1,
            durationSeconds: 9,
          },
        },
      },
    });

    const graph = buildMergedSoundEffectsFilterGraph({
      items: [
        resolved,
        resolveMergeSoundEffectRenderItem({
          item: {
            sound_effect_id: '22222222-2222-2222-2222-222222222222',
          },
        }),
      ],
    });

    expect(graph.outLabel).toBe('mix');
    expect(graph.filterComplex).toContain('atrim=start=0.4:duration=2.2');
    expect(graph.filterComplex).toContain('bass=f=180:t=q:w=0.707107:g=3');
    expect(graph.filterComplex).toContain('equalizer=f=1200:t=q:w=1.8:g=-2');
    expect(graph.filterComplex).toContain('treble=f=6400:t=q:w=0.707107:g=4');
    expect(graph.filterComplex).toContain('acompressor=threshold=');
    expect(graph.filterComplex).toContain('asoftclip=type=tanh');
    expect(graph.filterComplex).toContain('adelay=1250:all=1');
    expect(graph.filterComplex).toContain('amix=inputs=2:normalize=0[mix]');
  });

  it('prefers explicit trim values while preserving effective item settings metadata', () => {
    const resolved = resolveMergeSoundEffectRenderItem({
      item: {
        sound_effect_id: '33333333-3333-3333-3333-333333333333',
        trim_start_seconds: 0.75,
        duration_seconds: 1.5,
      },
      sourceDefaults: {
        volumePercent: 80,
        audioSettings: {
          trim: {
            startSeconds: 2,
            durationSeconds: 5,
          },
          echo: {
            enabled: true,
            mix: 0.2,
            delayMs: 220,
            feedback: 0.4,
          },
        },
      },
    });

    expect(resolved.delayMs).toBe(0);
    expect(resolved.volume).toBeCloseTo(0.8);
    expect(resolved.trimStartSeconds).toBe(0.75);
    expect(resolved.trimDurationSeconds).toBe(1.5);
    expect(resolved.audioSettings.echo.enabled).toBe(true);
    expect(resolved.audioSettings.trim.startSeconds).toBe(0.75);
    expect(resolved.audioSettings.trim.durationSeconds).toBe(1.5);
    expect(resolved.mergedFromItem.audio_settings_override.trim.startSeconds).toBe(0.75);
    expect(resolved.mergedFromItem.audio_settings_override.trim.durationSeconds).toBe(1.5);
  });
});