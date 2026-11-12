import "server-only";

import type { ChatMessage } from "@orbit/core";
import { z } from "zod";

/**
 * Optional AI rewriting through free providers. Every supported provider
 * speaks the OpenAI chat-completions format, so one small fetch covers all
 * of them. Keys stay on the server (never NEXT_PUBLIC_); without a key the
 * resume engine still tailors with its built-in rules.
 *
 * Several providers can be set at once (GROQ_API_KEY and GEMINI_API_KEY):
 * they're tried in order, so when one's free quota runs out or it's down,
 * the next one answers. Each provider also has a lighter fallback model.
 */

const PROVIDERS = {
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

export interface ProviderConfig {
  provider: ProviderName;
  label: string;
  baseUrl: string;
  model: string;
  fallbackModel: string | null;
  apiKey: string | null;
}

export interface LlmConfig extends ProviderConfig {
  /** Every configured provider in the order they're tried; the first is the one above. */
  chain: ProviderConfig[];
}

const key = z.string().trim().min(10).max(400).optional().catch(undefined);
const modelName = z.string().trim().regex(/^[\w.:/-]{1,100}$/).optional().catch(undefined);
const envSchema = z.object({
  LLM_PROVIDER: z.enum(["groq", "gemini", "ollama", "none"]).optional().catch(undefined),
  LLM_API_KEY: key,
  GROQ_API_KEY: key,
  GEMINI_API_KEY: key,
  LLM_MODEL: modelName,
  LLM_FALLBACK_MODEL: modelName,
  LLM_BASE_URL: z.url({ protocol: /^https?$/ }).optional().catch(undefined),
});

function provider(name: ProviderName, apiKey: string | null, env: z.infer<typeof envSchema>, custom: boolean): ProviderConfig {
  const preset = PROVIDERS[name];
  return {
    provider: name,
    label: preset.label,
    // A custom base URL is only honoured for Ollama, so a typo can't send resumes elsewhere.
    baseUrl: name === "ollama" && env.LLM_BASE_URL ? env.LLM_BASE_URL.replace(/\/$/, "") : preset.baseUrl,
    // LLM_MODEL / LLM_FALLBACK_MODEL only apply to the provider named in LLM_PROVIDER.
    model: (custom && env.LLM_MODEL) || preset.model,
    fallbackModel: (custom && env.LLM_FALLBACK_MODEL) || preset.fallback,
    apiKey,
  };
}

export function getLlmConfig(): LlmConfig | null {
  const env = envSchema.parse({
    LLM_PROVIDER: process.env.LLM_PROVIDER || undefined,
    LLM_API_KEY: process.env.LLM_API_KEY || undefined,
    GROQ_API_KEY: process.env.GROQ_API_KEY || undefined,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY || undefined,
    LLM_MODEL: process.env.LLM_MODEL || undefined,
    LLM_FALLBACK_MODEL: process.env.LLM_FALLBACK_MODEL || undefined,
    LLM_BASE_URL: process.env.LLM_BASE_URL || undefined,
  });
  if (env.LLM_PROVIDER === "none") return null;

  const keys: Record<ProviderName, string | undefined> = {
    groq: env.GROQ_API_KEY ?? (env.LLM_PROVIDER === "groq" ? env.LLM_API_KEY : undefined),
    gemini: env.GEMINI_API_KEY ?? (env.LLM_PROVIDER === "gemini" ? env.LLM_API_KEY : undefined),
    ollama: undefined,
  };
  // LLM_PROVIDER goes first; then Groq, then Gemini.
  const order: ProviderName[] = [...new Set<ProviderName>([...(env.LLM_PROVIDER ? [env.LLM_PROVIDER] : []), "groq", "gemini"])];
  const chain: ProviderConfig[] = [];
  for (const name of order) {
    if (name === "ollama") {
      if (env.LLM_PROVIDER === "ollama") chain.push(provider("ollama", null, env, true));
      continue;
    }
    const apiKey = keys[name];
    if (apiKey) chain.push(provider(name, apiKey, env, env.LLM_PROVIDER === name));
  }
  const first = chain[0];
  return first ? { ...first, chain } : null;
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

class RateLimitError extends LlmError {}

const completionSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1),
});

/**
 * One JSON-mode chat completion. Tries each provider in order: its main
 * model, then (if rate-limited) its lighter model, then the next provider.
 * Returns the reply, the model and the provider that answered.
 */
export async function chatJson(config: LlmConfig, messages: ChatMessage[]): Promise<{ content: string; model: string; label: string }> {
  let firstError: LlmError | null = null;
  for (const target of config.chain) {
    try {
      return { content: await complete(target, target.model, messages), model: target.model, label: target.label };
    } catch (error) {
      if (error instanceof RateLimitError && target.fallbackModel && target.fallbackModel !== target.model) {
        try {
          return { content: await complete(target, target.fallbackModel, messages), model: target.fallbackModel, label: target.label };
        } catch (fallbackError) {
          error = fallbackError;
        }
      }
      if (!(error instanceof LlmError)) throw error;
      console.warn(`AI provider ${target.provider} failed, trying the next one:`, error.message);
      firstError ??= error;
    }
  }
  if (config.chain.length > 1 && firstError instanceof RateLimitError) {
    throw new LlmError(firstError.message, "Every connected AI's free limit is used up for now. Try again later.");
  }
  throw firstError ?? new LlmError("no AI provider configured", "AI rewording is off.");
}

async function complete(config: ProviderConfig, model: string, messages: ChatMessage[]): Promise<string> {
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
    const keyName = config.provider === "groq" ? "GROQ_API_KEY" : config.provider === "gemini" ? "GEMINI_API_KEY" : "LLM_API_KEY";
    const userMessage =
      response.status === 429
        ? `${config.label}'s free limit is used up for now. Try again later.`
        : response.status === 401 || response.status === 403
          ? `${config.label} rejected the API key. Check ${keyName}.`
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
