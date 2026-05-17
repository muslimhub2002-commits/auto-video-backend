import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import {
  MediaBinaryUnavailableError,
  runFfmpeg,
  runFfprobe,
} from './ffmpeg.utils';

jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));

jest.mock('@remotion/renderer', () => ({
  RenderInternals: {
    callFf: jest.fn(),
  },
}));

type MockChildProcess = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
};

const mockedSpawn = spawn as unknown as jest.Mock;
const mockedCallFf = (jest.requireMock('@remotion/renderer') as {
  RenderInternals: { callFf: unknown };
}).RenderInternals.callFf as jest.Mock<() => Promise<{ stdout: string; stderr: string }>>;

const createMockChildProcess = (params?: {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  error?: NodeJS.ErrnoException;
}): MockChildProcess => {
  const child = new EventEmitter() as MockChildProcess;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();

  queueMicrotask(() => {
    if (params?.error) {
      child.emit('error', params.error);
      return;
    }

    if (params?.stdout) {
      child.stdout.emit('data', Buffer.from(params.stdout));
    }

    if (params?.stderr) {
      child.stderr.emit('data', Buffer.from(params.stderr));
    }

    child.emit('close', params?.exitCode ?? 0);
  });

  return child;
};

describe('ffmpeg binary resolution', () => {
  const originalEnv = {
    FFMPEG_PATH: process.env.FFMPEG_PATH,
    FFPROBE_PATH: process.env.FFPROBE_PATH,
  };

  afterEach(() => {
    if (typeof originalEnv.FFMPEG_PATH === 'string') {
      process.env.FFMPEG_PATH = originalEnv.FFMPEG_PATH;
    } else {
      delete process.env.FFMPEG_PATH;
    }

    if (typeof originalEnv.FFPROBE_PATH === 'string') {
      process.env.FFPROBE_PATH = originalEnv.FFPROBE_PATH;
    } else {
      delete process.env.FFPROBE_PATH;
    }

    mockedSpawn.mockReset();
    mockedCallFf.mockReset();
    jest.restoreAllMocks();
  });

  it('prefers configured env binaries over PATH lookups', async () => {
    process.env.FFMPEG_PATH = 'C:\\custom\\ffmpeg.exe';
    jest.spyOn(fs, 'statSync').mockReturnValue({
      isFile: () => true,
    } as fs.Stats);
    mockedSpawn.mockReturnValue(
      createMockChildProcess({ stdout: 'ffmpeg version test' }),
    );

    const result = await runFfmpeg({
      args: ['-version'],
      allowRemotionFallback: true,
    });

    expect(result.source).toBe('env');
    expect(mockedSpawn).toHaveBeenCalledWith(
      'C:\\custom\\ffmpeg.exe',
      ['-version'],
      expect.objectContaining({ windowsHide: true }),
    );
    expect(mockedCallFf).not.toHaveBeenCalled();
  });

  it('falls back to Remotion only when PATH lookup fails and fallback is enabled', async () => {
    delete process.env.FFMPEG_PATH;
    mockedSpawn.mockReturnValue(
      createMockChildProcess({
        error: Object.assign(new Error('spawn ffmpeg ENOENT'), {
          code: 'ENOENT',
        }),
      }),
    );
    mockedCallFf.mockResolvedValue({ stdout: 'remotion', stderr: '' });

    const result = await runFfmpeg({
      args: ['-version'],
      allowRemotionFallback: true,
    });

    expect(result.source).toBe('remotion');
    expect(mockedCallFf).toHaveBeenCalledWith(
      expect.objectContaining({
        bin: 'ffmpeg',
        args: ['-version'],
        binariesDirectory: null,
      }),
    );
  });

  it('rejects when ffprobe is unavailable and Remotion fallback is disabled', async () => {
    delete process.env.FFPROBE_PATH;
    mockedSpawn.mockReturnValue(
      createMockChildProcess({
        error: Object.assign(new Error('spawn ffprobe ENOENT'), {
          code: 'ENOENT',
        }),
      }),
    );

    await expect(
      runFfprobe({
        args: ['-version'],
        allowRemotionFallback: false,
      }),
    ).rejects.toBeInstanceOf(MediaBinaryUnavailableError);

    expect(mockedCallFf).not.toHaveBeenCalled();
  });
});