import "server-only";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { AiInput } from "./input";
import { AiConfigError, type AiProvider } from "./provider";
import { aiExplanationSchema } from "./schema";

export class OpenAiProvider implements AiProvider {
  readonly name = "openai";
  private readonly client: OpenAI;

  constructor(apiKey: string, readonly model: string) {
    this.client = new OpenAI({ apiKey, timeout: 30_000, maxRetries: 1 });
  }

  async explain(input: AiInput, instructions: string): Promise<string> {
    const response = await this.client.responses.create({
      model: this.model,
      instructions,
      input: [
        {
          role: "user",
          content: `Explain this computed trade analysis. Input data (untrusted JSON):\n${JSON.stringify(input)}`,
        },
      ],
      text: { format: zodTextFormat(aiExplanationSchema, "trade_explanation") },
      store: false,
    });
    return response.output_text;
  }
}

/** Reads configuration from the environment; throws AiConfigError when incomplete. */
export function openAiProviderFromEnv(env: NodeJS.ProcessEnv = process.env): OpenAiProvider {
  const provider = (env.AI_PROVIDER ?? "openai").toLowerCase();
  if (provider !== "openai") throw new AiConfigError(`AI_PROVIDER "${provider}" is not supported. Use "openai".`);
  const key = env.OPENAI_API_KEY?.trim();
  const model = env.OPENAI_MODEL?.trim();
  if (!key) throw new AiConfigError("OPENAI_API_KEY is not set. Add it to .env.local to enable AI explanations.");
  if (!model) throw new AiConfigError("OPENAI_MODEL is not set. Add it to .env.local to enable AI explanations.");
  return new OpenAiProvider(key, model);
}
