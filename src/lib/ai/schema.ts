import { z } from "zod";

// Structured output contract for the AI explanation. Every field is required
// (strict JSON schema); lists may be empty.

const teamExplanationSchema = z.object({
  team: z.enum(["Team A", "Team B"]),
  explanation: z.string().min(1).max(1200),
  positionalImprovements: z.array(z.string().max(300)).max(8),
  positionalWeaknesses: z.array(z.string().max(300)).max(8),
  depthAndRosterImplications: z.array(z.string().max(300)).max(8),
});

export const aiExplanationSchema = z.object({
  verdict: z.enum(["both_improve", "one_improves", "neither_improves", "insufficient_data"]),
  summary: z.string().min(1).max(800),
  teams: z.array(teamExplanationSchema).length(2),
  risks: z.array(z.string().max(300)).max(10),
  assumptions: z.array(z.string().max(300)).max(10),
  limitations: z.array(z.string().max(300)).max(10),
});

export type AiExplanation = z.infer<typeof aiExplanationSchema>;

export interface ExplanationResult {
  source: "ai" | "deterministic";
  /** Model id when source is "ai". */
  model: string | null;
  /** Why the deterministic fallback was used, when it was. */
  fallbackReason: string | null;
  /** Whether this is a configuration problem the user/operator should fix. */
  configError: boolean;
  explanation: AiExplanation;
}
