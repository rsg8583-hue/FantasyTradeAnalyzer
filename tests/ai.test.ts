import { describe, expect, it } from "vitest";
import { explainAnalysis } from "@/lib/ai/explain";
import { buildAiInput, formatPct } from "@/lib/ai/input";
import { openAiProviderFromEnv } from "@/lib/ai/openai";
import { AiConfigError, type AiProvider } from "@/lib/ai/provider";
import type { AiExplanation } from "@/lib/ai/schema";
import { validateAiOutput } from "@/lib/ai/validate";
import { analyzeTrade } from "@/lib/engine/trade";
import { SnapshotProjectionProvider } from "@/lib/projections/snapshotProvider";
import { fbPlayer, makeFootballSnapshot, trade } from "./helpers/snapshot";

const snap = makeFootballSnapshot({
  teamA: [fbPlayer(101, "QB", 20), fbPlayer(102, "RB", 15), fbPlayer(103, "WR", 12), fbPlayer(104, "RB", 8), fbPlayer(105, "WR", 6)],
  teamB: [fbPlayer(201, "QB", 18), fbPlayer(202, "RB", 10), fbPlayer(204, "WR", 14), fbPlayer(203, "WR", 11), fbPlayer(205, "RB", 5), fbPlayer(206, "WR", 4)],
});
const analysis = analyzeTrade(snap, trade(snap, { sends: [102] }, { sends: [204] }), new SnapshotProjectionProvider());
// Team A: 55 → 54 (−1.8%); Team B: 53 → 54 (+1.9%)

const valid = (): AiExplanation => ({
  verdict: "one_improves",
  summary: "Team B gains 1.9% while Team A drops 1.8% in projected lineup points for week 1.",
  teams: [
    { team: "Team A", explanation: "Loses its top RB.", positionalImprovements: ["WR"], positionalWeaknesses: ["RB"], depthAndRosterImplications: [] },
    { team: "Team B", explanation: "Gains an RB1.", positionalImprovements: ["RB"], positionalWeaknesses: ["WR"], depthAndRosterImplications: [] },
  ],
  risks: [],
  assumptions: [],
  limitations: [],
});

const fakeProvider = (impl: () => Promise<string>): AiProvider => ({ name: "fake", model: "fake-model", explain: impl });

describe("validateAiOutput", () => {
  it("accepts a schema-valid response that cites the calculated percentages", () => {
    expect(formatPct(analysis.teams[0].percentChange!)).toBe("−1.8%");
    expect(validateAiOutput(JSON.stringify(valid()), analysis).ok).toBe(true);
  });

  it("rejects malformed JSON", () => {
    const r = validateAiOutput("{not json", analysis);
    expect(r).toEqual({ ok: false, reason: "AI response was not valid JSON." });
  });

  it("rejects responses missing required fields", () => {
    const { risks: _omit, ...partial } = valid();
    void _omit;
    expect(validateAiOutput(JSON.stringify(partial), analysis).ok).toBe(false);
  });

  it("rejects a verdict that differs from the calculation", () => {
    expect(validateAiOutput(JSON.stringify({ ...valid(), verdict: "both_improve" }), analysis).ok).toBe(false);
  });

  it("rejects invented or altered percentages", () => {
    const bad = { ...valid(), summary: "Team B gains 5% in win probability." };
    const r = validateAiOutput(JSON.stringify(bad), analysis);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/5%/);
    const reworded = { ...valid(), summary: "Team B improves by 2 percent." };
    expect(validateAiOutput(JSON.stringify(reworded), analysis).ok).toBe(false);
  });

  it("rejects responses that do not cover both teams", () => {
    const one = valid();
    one.teams[1].team = "Team A";
    expect(validateAiOutput(JSON.stringify(one), analysis).ok).toBe(false);
  });
});

describe("explainAnalysis", () => {
  it("uses the AI explanation when it validates", async () => {
    const r = await explainAnalysis(analysis, snap, () => fakeProvider(async () => JSON.stringify(valid())));
    expect(r.source).toBe("ai");
    expect(r.model).toBe("fake-model");
  });

  it("falls back to the deterministic explanation on malformed output", async () => {
    const r = await explainAnalysis(analysis, snap, () => fakeProvider(async () => '{"verdict":"both_improve"}'));
    expect(r.source).toBe("deterministic");
    expect(r.fallbackReason).toMatch(/schema/);
    expect(r.explanation.verdict).toBe("one_improves");
    expect(r.explanation.teams[0].explanation).toContain("−1.8%");
  });

  it("falls back when the provider errors", async () => {
    const r = await explainAnalysis(analysis, snap, () =>
      fakeProvider(async () => {
        throw Object.assign(new Error("boom"), { status: 500 });
      }),
    );
    expect(r.source).toBe("deterministic");
    expect(r.configError).toBe(false);
  });

  it("reports a missing API key as a configuration error", async () => {
    const r = await explainAnalysis(analysis, snap, () => openAiProviderFromEnv({ OPENAI_MODEL: "x" } as unknown as NodeJS.ProcessEnv));
    expect(r.source).toBe("deterministic");
    expect(r.configError).toBe(true);
    expect(r.fallbackReason).toMatch(/OPENAI_API_KEY is not set/);
    expect(() => openAiProviderFromEnv({ OPENAI_API_KEY: "k" } as unknown as NodeJS.ProcessEnv)).toThrow(AiConfigError);
  });

  it("reports a rejected API key as a configuration error", async () => {
    const r = await explainAnalysis(analysis, snap, () =>
      fakeProvider(async () => {
        throw Object.assign(new Error("unauthorized"), { status: 401 });
      }),
    );
    expect(r.configError).toBe(true);
  });
});

describe("buildAiInput", () => {
  it("contains computed results but no team names or credentials", () => {
    const input = buildAiInput(analysis, snap);
    const text = JSON.stringify(input);
    expect(text).not.toContain("Alpha");
    expect(text).not.toContain("Beta");
    expect(text).not.toMatch(/espn_s2|SWID|cookie/i);
    expect(input.computedVerdict).toBe("one_improves");
    expect(input.teams[0].percentChangeDisplayed).toBe("−1.8%");
    expect(input.teams[1].percentChangeDisplayed).toBe("+1.9%");
    expect(input.projectionWindow.label).toMatch(/week 1/);
  });
});
