import { z } from "zod";

// Request bodies accepted by the server routes. Shared with the client for
// type inference only; the server is the authority.

export const sportSchema = z.enum(["football", "basketball"]);

/** SWID is a GUID in braces; braces are added if the user omits them. */
export const swidSchema = z
  .string()
  .trim()
  .transform((s) => (s.startsWith("{") ? s : `{${s}}`))
  .pipe(
    z
      .string()
      .regex(
        /^\{[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\}$/,
        "SWID should look like {XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}.",
      ),
  );

/** espn_s2 is an opaque token; restrict charset so it cannot inject header syntax. */
export const espnS2Schema = z
  .string()
  .trim()
  .min(20, "espn_s2 looks too short.")
  .max(4096, "espn_s2 looks too long.")
  .regex(/^[A-Za-z0-9%+/=_.\-]+$/, "espn_s2 contains unexpected characters. Copy only the cookie value.");

export const connectRequestSchema = z
  .object({
    league: z.string().trim().min(1, "Enter a league id or URL.").max(500),
    sport: sportSchema,
    season: z.coerce.number().int().min(2018).max(2100),
    espnS2: z.string().trim().max(4096).optional().default(""),
    swid: z.string().trim().max(100).optional().default(""),
  })
  .superRefine((v, ctx) => {
    const hasS2 = v.espnS2.length > 0;
    const hasSwid = v.swid.length > 0;
    if (hasS2 !== hasSwid) {
      ctx.addIssue({
        code: "custom",
        message: "Provide both espn_s2 and SWID, or neither for a public league.",
        path: [hasS2 ? "swid" : "espnS2"],
      });
    }
  });
export type ConnectRequest = z.infer<typeof connectRequestSchema>;

export const demoRequestSchema = z.object({ sport: sportSchema });

const leagueNameSchema = z.string().trim().min(1, "Enter a name.").max(60);
const playerId = z.number().int().positive();

export const createCustomRequestSchema = z.object({
  name: leagueNameSchema,
  sport: sportSchema,
  season: z.coerce.number().int().min(2018).max(2100),
  presetId: z.string().trim().min(1).max(40),
});
export type CreateCustomRequest = z.infer<typeof createCustomRequestSchema>;

/** One edit to the custom league. The server applies it and rebuilds the snapshot. */
export const customActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("addTeam"), name: leagueNameSchema }),
  z.object({ action: z.literal("renameTeam"), teamId: z.number().int(), name: leagueNameSchema }),
  z.object({ action: z.literal("removeTeam"), teamId: z.number().int() }),
  z.object({ action: z.literal("addPlayer"), teamId: z.number().int(), playerId }),
  z.object({ action: z.literal("removePlayer"), teamId: z.number().int(), playerId }),
]);
export type CustomAction = z.infer<typeof customActionSchema>;

export const playerSearchSchema = z.object({
  q: z.string().trim().max(60).optional().default(""),
  limit: z.coerce.number().int().min(1).max(60).optional().default(40),
});

const playerIdList = z.array(z.number().int().nonnegative()).max(30);

export const tradeSideSchema = z.object({
  teamId: z.number().int(),
  sends: playerIdList,
  drops: playerIdList.default([]),
  adds: playerIdList.default([]),
});

export const tradeRequestSchema = z.object({
  /** fetchedAt of the snapshot the user built the trade against. */
  snapshotFetchedAt: z.string().max(64),
  teamA: tradeSideSchema,
  teamB: tradeSideSchema,
});
export type TradeRequest = z.infer<typeof tradeRequestSchema>;
export type TradeSideRequest = z.infer<typeof tradeSideSchema>;
