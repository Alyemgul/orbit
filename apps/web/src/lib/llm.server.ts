import "server-only";

import type { ChatMessage } from "@orbit/core";
import { z } from "zod";

/**
 * Optional AI rewriting through a free provider. Every supported provider
 * speaks the OpenAI chat-completions format, so one small fetch covers all
 * of them. Keys stay on the server (never NEXT_PUBLIC_); without a key the
 * resume engine still tailors with its built-in rules.
 */

const PROVIDERS = {
  // The fallback is a lighter free model with its own, larger quota, used when the main one is rate-limited.
  groq: {
    baseUrl: "https://api.groq.com/openai/v1",
    model: "llama-3.3-70b-versatile",
    fallback: "llama-3.1-8b-instant",
    needsKey: true,
    label: "Groq",
  },
  gemini: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-flash-latest",
    fallback: "gemini-flash-lite-latest",
    needsKey: true,
    label: "Gemini",
  },
  ollama: { baseUrl: "http://127.0.0.1:11434/v1", model: "llama3.1:8b", fallback: null, needsKey: false, label: "Ollama (local)" },
} as const;

type ProviderName = keyof typeof PROVIDERS;

export interface LlmConfig {
  provider: ProviderName;
  label: string;
  baseUrl: string;
  model: string;
  fallbackModel: string | null;
  apiKey: string | null;
}

const envSchema = z.object({
  LLM_PROVIDER: z.enum(["groq", "gemini", "ollama", "none"]).catch("none"),
  LLM_API_KEY: z.string().trim().min(10).max(400).optional().catch(undefined),
  LLM_MODEL: z.string().trim().regex(/^[\w.:/-]{1,100}$/).optional().catch(undefined),
  LLM_FALLBACK_MODEL: z.string().trim().regex(/^[\w.:/-]{1,100}$/).optional().catch(undefined),
  LLM_BASE_URL: z.url({ protocol: /^https?$/ }).optional().catch(undefined),
});

export function getLlmConfig(): LlmConfig | null {
  const env = envSchema.parse({
    LLM_PROVIDER: process.env.LLM_PROVIDER,
    LLM_API_KEY: process.env.LLM_API_KEY || undefined,
    LLM_MODEL: process.env.LLM_MODEL || undefined,
    LLM_FALLBACK_MODEL: process.env.LLM_FALLBACK_MODEL || undefined,
    LLM_BASE_URL: process.env.LLM_BASE_URL || undefined,
  });
  if (env.LLM_PROVIDER === "none") return null;
  const preset = PROVIDERS[env.LLM_PROVIDER];
  if (preset.needsKey && !env.LLM_API_KEY) return null;
  return {
    provider: env.LLM_PROVIDER,
    label: preset.label,
    // A custom base URL is only honoured for Ollama, so a typo can't send resumes elsewhere.
    baseUrl: env.LLM_PROVIDER === "ollama" && env.LLM_BASE_URL ? env.LLM_BASE_URL.replace(/\/$/, "") : preset.baseUrl,
    model: env.LLM_MODEL ?? preset.model,
    fallbackModel: env.LLM_FALLBACK_MODEL ?? preset.fallback,
    apiKey: env.LLM_API_KEY ?? null,
  };
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly userMessage: string,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

const completionSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1),
});

/**
 * One JSON-mode chat completion. When the main model is rate-limited, tries
 * the lighter fallback model once. Returns the reply text and the model used.
 */
export async function chatJson(config: LlmConfig, messages: ChatMessage[]): Promise<{ content: string; model: string }> {
  try {
    return { content: await complete(config, config.model, messages), model: config.model };
  } catch (error) {
    if (error instanceof RateLimitError && config.fallbackModel && config.fallbackModel !== config.model) {
      return { content: await complete(config, config.fallbackModel, messages), model: config.fallbackModel };
    }
    throw error;
  }
}

class RateLimitError extends LlmError {}

async function complete(config: LlmConfig, model: string, messages: ChatMessage[]): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.2,
        max_tokens: 3000,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(60_000),
      cache: "no-store",
    });
  } catch (error) {
    throw new LlmError(`${config.provider} request failed: ${(error as Error).message}`, `${config.label} didn't respond. Try again in a minute.`);
  }

  if (!response.ok) {
    // Provider error bodies can echo the request; log only the status.
    const userMessage =
      response.status === 429
        ? `${config.label}'s free limit is used up for now. Try again later.`
        : response.status === 401 || response.status === 403
          ? `${config.label} rejected the API key. Check LLM_API_KEY.`
          : response.status === 404
            ? `${config.label} doesn't know the model "${model}". Set LLM_MODEL or LLM_FALLBACK_MODEL.`
            : `${config.label} returned an error (${response.status}).`;
    const ErrorType = response.status === 429 ? RateLimitError : LlmError;
    throw new ErrorType(`${config.provider} ${model} HTTP ${response.status}`, userMessage);
  }

  const parsed = completionSchema.safeParse(await response.json().catch(() => null));
  const content = parsed.success ? parsed.data.choices[0]!.message.content : null;
  if (!content) throw new LlmError(`${config.provider} returned no content`, `${config.label} sent back an empty reply.`);
  return content;
}
