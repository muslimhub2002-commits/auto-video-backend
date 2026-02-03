export type LlmRole = 'system' | 'user' | 'assistant';

export type LlmMessage = {
  role: LlmRole;
  content: string;
};

export type LlmStreamParams = {
  model: string;
  messages: LlmMessage[];
  temperature?: number;
  maxTokens?: number;
};

export type LlmCompleteParams = {
  model: string;
  messages: LlmMessage[];
  temperature?: number;
  maxTokens?: number;
};

export type LlmCompleteJsonParams = {
  model: string;
  messages: LlmMessage[];
  temperature?: number;
  maxTokens?: number;
  // Optional: retries if parsing fails.
  retries?: number;
};
