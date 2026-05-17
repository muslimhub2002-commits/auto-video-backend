import { spawn } from 'child_process';
import * as fs from 'fs';

export type FfBinaryName = 'ffmpeg' | 'ffprobe';
export type FfBinarySource = 'env' | 'path' | 'remotion';

const MEDIA_BINARY_ENV_KEYS = {
  ffmpeg: 'FFMPEG_PATH',
  ffprobe: 'FFPROBE_PATH',
} as const;

type MediaBinaryEnvKey =
  (typeof MEDIA_BINARY_ENV_KEYS)[keyof typeof MEDIA_BINARY_ENV_KEYS];

type RemotionLogLevel = 'error' | 'warn';

export type RunFfCommandOptions = {
  args: string[];
  allowRemotionFallback?: boolean;
  remotionLogLevel?: RemotionLogLevel;
};

export type FfCommandResult = {
  source: FfBinarySource;
  stdout: string;
  stderr: string;
};

export class MediaBinaryUnavailableError extends Error {
  readonly bin: FfBinaryName;
  readonly envKey: MediaBinaryEnvKey;
  readonly configuredPath: string | null;

  constructor(params: {
    bin: FfBinaryName;
    envKey: MediaBinaryEnvKey;
    configuredPath?: string | null;
    allowRemotionFallback: boolean;
  }) {
    const configuredPath = params.configuredPath ?? null;
    const message = configuredPath
      ? `${params.envKey} points to an invalid ${params.bin} binary: ${configuredPath}`
      : params.allowRemotionFallback
        ? `Unable to resolve ${params.bin}. Set ${params.envKey} or install ${params.bin} on PATH.`
        : `Unable to resolve ${params.bin}. Set ${params.envKey} or install ${params.bin} on PATH; Remotion fallback is disabled for this call.`;

    super(message);
    this.name = 'MediaBinaryUnavailableError';
    this.bin = params.bin;
    this.envKey = params.envKey;
    this.configuredPath = configuredPath;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class MediaCommandError extends Error {
  readonly bin: FfBinaryName;
  readonly source: FfBinarySource;
  readonly command: string;
  readonly args: readonly string[];
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;

  constructor(params: {
    bin: FfBinaryName;
    source: FfBinarySource;
    command: string;
    args: string[];
    exitCode: number | null;
    stdout: string;
    stderr: string;
  }) {
    const renderedCommand = formatCommandForDisplay(
      params.command,
      params.args,
    );
    const stderr = params.stderr.trim();
    const suffix = stderr ? `\n${stderr}` : '';

    super(
      `Command failed with exit code ${String(params.exitCode ?? 'unknown')} (${params.source} ${params.bin}): ${renderedCommand}${suffix}`,
    );

    this.name = 'MediaCommandError';
    this.bin = params.bin;
    this.source = params.source;
    this.command = params.command;
    this.args = params.args;
    this.exitCode = params.exitCode;
    this.stdout = params.stdout;
    this.stderr = params.stderr;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

const normalizeConfiguredBinaryPath = (value?: string | null) => {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

const isExistingFile = (filePath: string) => {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
};

const isMissingBinarySpawnError = (error: unknown) => {
  if (!error || typeof error !== 'object') return false;
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
};

const quoteArg = (value: string) => {
  if (!/[\s"]/u.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
};

const formatCommandForDisplay = (command: string, args: readonly string[]) => {
  return [quoteArg(command), ...args.map((arg) => quoteArg(arg))].join(' ');
};

const runResolvedBinary = async (params: {
  bin: FfBinaryName;
  source: Exclude<FfBinarySource, 'remotion'>;
  command: string;
  args: string[];
}): Promise<FfCommandResult> => {
  return new Promise<FfCommandResult>((resolve, reject) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    const child = spawn(params.command, params.args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout?.on('data', (chunk) => {
      stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    child.stderr?.on('data', (chunk) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    child.once('error', (error) => {
      reject(error);
    });

    child.once('close', (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = Buffer.concat(stderrChunks).toString('utf8');

      if (code === 0) {
        resolve({
          source: params.source,
          stdout,
          stderr,
        });
        return;
      }

      reject(
        new MediaCommandError({
          bin: params.bin,
          source: params.source,
          command: params.command,
          args: params.args,
          exitCode: code,
          stdout,
          stderr,
        }),
      );
    });
  });
};

const runWithRemotion = async (params: {
  bin: FfBinaryName;
  args: string[];
  logLevel: RemotionLogLevel;
}): Promise<FfCommandResult> => {
  const renderer: any = await import('@remotion/renderer');
  const task = renderer?.RenderInternals?.callFf?.({
    bin: params.bin,
    args: params.args,
    indent: false,
    logLevel: params.logLevel,
    binariesDirectory: null,
    cancelSignal: undefined,
  });

  if (!task || typeof task.then !== 'function') {
    throw new MediaBinaryUnavailableError({
      bin: params.bin,
      envKey: MEDIA_BINARY_ENV_KEYS[params.bin],
      allowRemotionFallback: true,
    });
  }

  const result = await task;

  return {
    source: 'remotion',
    stdout: String(result?.stdout ?? ''),
    stderr: String(result?.stderr ?? ''),
  };
};

const runMediaBinary = async (params: {
  bin: FfBinaryName;
  args: string[];
  allowRemotionFallback: boolean;
  remotionLogLevel: RemotionLogLevel;
}): Promise<FfCommandResult> => {
  const envKey = MEDIA_BINARY_ENV_KEYS[params.bin];
  const configuredPath = normalizeConfiguredBinaryPath(process.env[envKey]);

  if (configuredPath) {
    if (!isExistingFile(configuredPath)) {
      throw new MediaBinaryUnavailableError({
        bin: params.bin,
        envKey,
        configuredPath,
        allowRemotionFallback: params.allowRemotionFallback,
      });
    }

    return runResolvedBinary({
      bin: params.bin,
      source: 'env',
      command: configuredPath,
      args: params.args,
    });
  }

  try {
    return await runResolvedBinary({
      bin: params.bin,
      source: 'path',
      command: params.bin,
      args: params.args,
    });
  } catch (error) {
    if (!isMissingBinarySpawnError(error)) {
      throw error;
    }
  }

  if (!params.allowRemotionFallback) {
    throw new MediaBinaryUnavailableError({
      bin: params.bin,
      envKey,
      allowRemotionFallback: false,
    });
  }

  return runWithRemotion({
    bin: params.bin,
    args: params.args,
    logLevel: params.remotionLogLevel,
  });
};

export const runFfmpeg = async (
  params: RunFfCommandOptions,
): Promise<FfCommandResult> => {
  return runMediaBinary({
    bin: 'ffmpeg',
    args: params.args,
    allowRemotionFallback: params.allowRemotionFallback ?? false,
    remotionLogLevel: params.remotionLogLevel ?? 'warn',
  });
};

export const runFfprobe = async (
  params: RunFfCommandOptions,
): Promise<FfCommandResult> => {
  return runMediaBinary({
    bin: 'ffprobe',
    args: params.args,
    allowRemotionFallback: params.allowRemotionFallback ?? false,
    remotionLogLevel: params.remotionLogLevel ?? 'error',
  });
};