import type { LeagueSnapshot } from "@/lib/domain/types";
import type { TradeAnalysis } from "@/lib/engine/types";
import { deterministicExplanation } from "./fallback";
import { buildAiInput } from "./input";
import { AiConfigError, SYSTEM_INSTRUCTIONS, type AiProvider } from "./provider";
import type { ExplanationResult } from "./schema";
import { validateAiOutput } from "./validate";

/**
 * Produces an explanation for an already-computed analysis. The AI is used
 * only for prose; on any failure the deterministic explanation is returned
 * and the numbers are unaffected.
 */
export async function explainAnalysis(
  analysis: TradeAnalysis,
  snapshot: LeagueSnapshot,
  getProvider: () => AiProvider,
): Promise<ExplanationResult> {
  const fallback = (reason: string, configError = false, model: string | null = null): ExplanationResult => ({
    source: "deterministic",
    model,
    fallbackReason: reason,
    configError,
    explanation: deterministicExplanation(analysis),
  });

  let provider: AiProvider;
  try {
    provider = getProvider();
  } catch (e) {
    if (e instanceof AiConfigError) return fallback(e.message, true);
    return fallback("The AI provider could not be initialized.", true);
  }

  let raw: string;
  try {
    raw = await provider.explain(buildAiInput(analysis, snapshot), SYSTEM_INSTRUCTIONS);
  } catch (e) {
    const status = (e as { status?: number })?.status;
    if (status === 401 || status === 403) {
      return fallback("The AI provider rejected the API key. Check OPENAI_API_KEY.", true, provider.model);
    }
    if (status === 404 || status === 400) {
      return fallback(`The AI request was rejected (HTTP ${status}). Check that OPENAI_MODEL is a valid model for your account.`, true, provider.model);
    }
    if (status === 429) return fallback("The AI provider is rate limiting requests. Try again later.", false, provider.model);
    return fallback("The AI provider did not respond successfully.", false, provider.model);
  }

  const validated = validateAiOutput(raw, analysis);
  if (!validated.ok) return fallback(`${validated.reason} Showing the deterministic explanation instead.`, false, provider.model);
  return {
    source: "ai",
    model: provider.model,
    fallbackReason: null,
    configError: false,
    explanation: validated.explanation,
  };
}
