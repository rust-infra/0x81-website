export const GEMINI_STT_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/interactions';
export const GEMINI_STT_DEFAULT_MODEL = 'gemini-3.8-flash';

export interface GeminiSttInput {
  audioBase64: string;
  mimeType: string;
  languageCode: string;
  hints?: string[];
}

export interface GeminiSttOptions {
  apiKey: string;
  model?: string;
  endpoint?: string;
}

export interface CloudTranscriptionResult {
  text: string;
  provider: 'gemini';
  model: string;
}

export interface GeminiSttDeps {
  fetchImpl?: typeof fetch;
}

export interface GeminiSttRequest {
  model: string;
  input: [
    { type: 'text'; text: string },
    { type: 'audio'; data: string; mime_type: string },
  ];
  response_format: {
    type: 'object';
    properties: { transcript: { type: 'string' } };
    required: ['transcript'];
  };
}

export function buildGeminiSttRequest(input: GeminiSttInput, model: string): GeminiSttRequest {
  const language = input.languageCode || 'en-US';
  const hints = Array.from(
    new Set((input.hints ?? []).map((hint) => hint.trim()).filter(Boolean))
  ).slice(0, 20);
  return {
    model,
    input: [
      {
        type: 'text',
        text:
          `Transcribe the spoken English verbatim. The expected language is ${language}. ` +
          'Return only the exact words spoken, without translation, explanation, summary, or added content. ' +
          'Preserve technical terms and punctuation when they are clear.' +
          (hints.length ? ` Relevant context: ${hints.join(', ')}.` : ''),
      },
      {
        type: 'audio',
        data: input.audioBase64,
        mime_type: input.mimeType,
      },
    ],
    response_format: {
      type: 'object',
      properties: {
        transcript: { type: 'string' },
      },
      required: ['transcript'],
    },
  };
}

function transcriptFromText(text: unknown): string | null {
  if (typeof text !== 'string' || !text.trim()) return null;
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as { transcript?: unknown };
      if (typeof parsed.transcript === 'string' && parsed.transcript.trim()) {
        return parsed.transcript.trim();
      }
    } catch {
      // fall through to plain text
    }
  }
  return trimmed;
}

export function parseGeminiTranscript(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const data = payload as Record<string, unknown>;
  const direct = transcriptFromText(data.output_text ?? data.outputText);
  if (direct) return direct;

  for (const key of ['output', 'outputs']) {
    const value = data[key];
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (!item || typeof item !== 'object') continue;
      const text = transcriptFromText((item as Record<string, unknown>).text);
      if (text) return text;
      const content = (item as Record<string, unknown>).content;
      const fromContent = transcriptFromText(content);
      if (fromContent) return fromContent;
    }
  }

  const candidates = data.candidates;
  if (Array.isArray(candidates)) {
    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== 'object') continue;
      const content = (candidate as Record<string, unknown>).content;
      if (!content || typeof content !== 'object') continue;
      const parts = (content as Record<string, unknown>).parts;
      if (!Array.isArray(parts)) continue;
      for (const part of parts) {
        if (!part || typeof part !== 'object') continue;
        const text = transcriptFromText((part as Record<string, unknown>).text);
        if (text) return text;
      }
    }
  }

  return transcriptFromText(data.response);
}

export async function transcribeWithGemini(
  input: GeminiSttInput,
  options: GeminiSttOptions,
  deps: GeminiSttDeps = {}
): Promise<CloudTranscriptionResult> {
  const apiKey = options.apiKey.trim();
  if (!apiKey) throw new Error('Gemini API key is required');
  const model = options.model?.trim() || GEMINI_STT_DEFAULT_MODEL;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const response = await fetchImpl(options.endpoint || GEMINI_STT_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(buildGeminiSttRequest(input, model)),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Gemini transcription failed (${response.status})`);
  }
  const text = parseGeminiTranscript(payload);
  if (!text) throw new Error('Gemini returned no transcript');
  return { text, provider: 'gemini', model };
}
