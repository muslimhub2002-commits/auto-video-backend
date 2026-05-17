import { afterEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('../../common/runtime/ffmpeg.utils', () => {
  const actual = jest.requireActual('../../common/runtime/ffmpeg.utils') as Record<
    string,
    unknown
  >;
  return {
    ...actual,
    runFfmpeg: jest.fn(),
  };
});

import { InternalServerErrorException } from '@nestjs/common';
import {
  MediaBinaryUnavailableError,
  runFfmpeg,
} from '../../common/runtime/ffmpeg.utils';
import { SoundEffectsService } from './sound-effects.service';

const mockedRunFfmpeg =
  runFfmpeg as unknown as jest.Mock<
    () => Promise<{ source: string; stdout: string; stderr: string }>
  >;

describe('SoundEffectsService ffmpeg policy', () => {
  afterEach(() => {
    mockedRunFfmpeg.mockReset();
  });

  it('uses the shared runner without allowing Remotion fallback', async () => {
    mockedRunFfmpeg.mockResolvedValue({
      source: 'path',
      stdout: '',
      stderr: '',
    });

    const service = Object.create(SoundEffectsService.prototype) as SoundEffectsService;

    await (service as any).callFfmpeg(['-version']);

    expect(mockedRunFfmpeg).toHaveBeenCalledWith({
      args: ['-version'],
      allowRemotionFallback: false,
      remotionLogLevel: 'warn',
    });
  });

  it('surfaces an actionable HTTP exception for missing binaries', () => {
    const service = Object.create(SoundEffectsService.prototype) as SoundEffectsService;
    const exception = (service as any).createMissingFfmpegException(
      new MediaBinaryUnavailableError({
        bin: 'ffmpeg',
        envKey: 'FFMPEG_PATH',
        allowRemotionFallback: false,
      }),
    );

    expect(exception).toBeInstanceOf(InternalServerErrorException);
    expect(String(exception.message)).toContain(
      'Sound effects merge requires a full ffmpeg/ffprobe installation',
    );
  });
});