import * as fs from 'fs';
import type { WordTiming } from '../render-videos.types';

const BASE_URL = 'https://api.assemblyai.com';

type AssemblyAiTranscriptResponse = {
  id?: string;
  status?: string;
  error?: string;
  words?: Array<{
    text?: string;
    start?: number;
    end?: number;
    confidence?: number;
  }>;
};

const getApiKey = () => String(process.env.ASSEMBLYAI_API_KEY ?? '').trim();

export const isAssemblyAiEnabled = () => !!getApiKey();

const getHeaders = () => ({
  authorization: getApiKey(),
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const toSeconds = (value: unknown) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric / 1000;
};

const uploadAudio = async (audioPath: string): Promise<string> => {
  const audioData = await fs.promises.readFile(audioPath);
  const response = await fetch(`${BASE_URL}/v2/upload`, {
    method: 'POST',
    headers: {
      ...getHeaders(),
      'content-type': 'application/octet-stream',
    },
    body: audioData,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `AssemblyAI upload failed with ${response.status} ${response.statusText}${body ? `: ${body}` : ''}`,
    );
  }

  const payload = (await response.json()) as { upload_url?: string };
  const uploadUrl = String(payload.upload_url ?? '').trim();
  if (!uploadUrl) {
    throw new Error('AssemblyAI upload did not return upload_url');
  }

  return uploadUrl;
};

const createTranscript = async (audioUrl: string): Promise<string> => {
  const response = await fetch(`${BASE_URL}/v2/transcript`, {
    method: 'POST',
    headers: {
      ...getHeaders(),
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      audio_url: audioUrl,
      language_detection: true,
      speech_models: ['universal-3-pro', 'universal-2'],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `AssemblyAI transcript creation failed with ${response.status} ${response.statusText}${body ? `: ${body}` : ''}`,
    );
  }

  const payload = (await response.json()) as AssemblyAiTranscriptResponse;
  const transcriptId = String(payload.id ?? '').trim();
  if (!transcriptId) {
    throw new Error('AssemblyAI transcript creation did not return id');
  }

  return transcriptId;
};

const pollTranscript = async (transcriptId: string) => {
  const pollIntervalMs = Number(process.env.ASSEMBLYAI_POLL_INTERVAL_MS ?? '3000');
  const safePollIntervalMs = Number.isFinite(pollIntervalMs)
    ? Math.max(1000, pollIntervalMs)
    : 3000;

  for (;;) {
    const response = await fetch(`${BASE_URL}/v2/transcript/${transcriptId}`, {
      method: 'GET',
      headers: getHeaders(),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `AssemblyAI polling failed with ${response.status} ${response.statusText}${body ? `: ${body}` : ''}`,
      );
    }

    const payload = (await response.json()) as AssemblyAiTranscriptResponse;
    if (payload.status === 'completed') {
      return payload;
    }

    if (payload.status === 'error') {
      throw new Error(
        `AssemblyAI transcription failed${payload.error ? `: ${payload.error}` : ''}`,
      );
    }

    await sleep(safePollIntervalMs);
  }
};

export const alignWithAssemblyAi = async (audioPath: string): Promise<WordTiming[]> => {
  if (!isAssemblyAiEnabled()) {
    throw new Error('ASSEMBLYAI_API_KEY is not configured');
  }

  const uploadUrl = await uploadAudio(audioPath);
  const transcriptId = await createTranscript(uploadUrl);
  const transcript = await pollTranscript(transcriptId);
  const words = Array.isArray(transcript.words) ? transcript.words : [];

  return words
    .map((word) => {
      const text = String(word.text ?? '').trim();
      const startSeconds = toSeconds(word.start);
      const endSeconds = toSeconds(word.end);
      const confidence = Number(word.confidence);

      if (!text || startSeconds === null || endSeconds === null || endSeconds <= startSeconds) {
        return null;
      }

      return {
        text,
        startSeconds,
        endSeconds,
        ...(Number.isFinite(confidence) ? { confidence } : {}),
      } satisfies WordTiming;
    })
    .filter((word): word is WordTiming => word !== null);
};