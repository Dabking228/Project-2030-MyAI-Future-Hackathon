import { z } from "zod";

// Parsed Input Schemas

export const CoordinatesSchema = z.object({
    lat: z.number().describe("Latitude of the location"),
    lon: z.number().describe("Longitude of the location"),
    place_name: z.string().describe("Human-readable name of this place"),
});

export const ObjectiveSchema = z
    .enum(["time", "cost", "eco"])
    .describe(
        "Optimization goal: 'time' = fastest, 'cost' = cheapest, 'eco' = lowest carbon emissions"
    );

export const ParsedSingleRouteSchema = z.object({
    intent: z.literal("single_route"),
    origin: CoordinatesSchema,
    destination: CoordinatesSchema,
    optimize_for: ObjectiveSchema,
    return_alternatives: z
        .boolean()
        .default(true)
        .describe("Whether to show alternative routes"),
    raw_message: z.string().describe("The original user message verbatim"),
});

export const ParsedTSPRouteSchema = z.object({
    intent: z.literal("multi_destination"),
    origin: CoordinatesSchema,
    destinations: z
        .array(CoordinatesSchema)
        .min(2)
        .max(10)
        .describe("All destinations to visit"),
    optimize_for: ObjectiveSchema,
    return_to_origin: z
        .boolean()
        .default(false)
        .describe("Whether the route should loop back to the starting point"),
    raw_message: z.string().describe("The original user message verbatim"),
});

export const ParsedClarificationSchema = z.object({
    intent: z.literal("clarification_needed"),
    missing_fields: z
        .array(z.string())
        .describe("List of fields that could not be determined"),
    clarification_prompt: z
        .string()
        .describe("A friendly question to ask the user to fill the gaps"),
    raw_message: z.string().describe("The original user message verbatim"),
});

export const ParsedUserIntentSchema = z.discriminatedUnion("intent", [
    ParsedSingleRouteSchema,
    ParsedTSPRouteSchema,
    ParsedClarificationSchema,
]);

export type ParsedUserIntent = z.infer<typeof ParsedUserIntentSchema>;
export type ParsedSingleRoute = z.infer<typeof ParsedSingleRouteSchema>;
export type ParsedTSPRoute = z.infer<typeof ParsedTSPRouteSchema>;
export type ParsedClarification = z.infer<typeof ParsedClarificationSchema>;

// FastAPI Response Schemas

export const RouteLegSchema = z.object({
    from_stop_name: z.string(),
    to_stop_name: z.string(),
    agency_type: z.enum(["rail", "bus", "walk"]),
    edge_type: z.enum(["transit", "walk"]),
    departure_time: z.string().optional(),
    arrival_time: z.string().optional(),
    travel_time_sec: z.number(),
    fare_myr: z.number(),
    co2_grams: z.number(),
    distance_km: z.number(),
    route_id: z.string(),
    trip_id: z.string(),
});

export const CarbonSummarySchema = z.object({
    total_transit_co2_grams: z.number(),
    car_baseline_co2_grams: z.number(),
    co2_saved_grams: z.number(),
    co2_saved_percent: z.number(),
    equivalent_tree_days: z.number(),
    total_distance_km: z.number(),
    breakdown_by_mode: z.record(z.number()),
});

export const RouteResultSchema = z.object({
    legs: z.array(RouteLegSchema),
    total_time_sec: z.number(),
    total_fare_myr: z.number(),
    total_co2_grams: z.number(),
    total_distance_km: z.number(),
    car_co2_grams: z.number(),
    co2_saved_grams: z.number(),
    instructions: z.array(z.string()),
    objective: z.string(),
    carbon: CarbonSummarySchema.optional(),
});

export const RouteResponseSchema = z.object({
    recommended: RouteResultSchema.nullable(),
    alternatives: z.array(RouteResultSchema),
    reasoning: z.string(),
    origin_stop: z
        .object({ id: z.string(), name: z.string(), distance_m: z.number() })
        .optional(),
    destination_stop: z
        .object({ id: z.string(), name: z.string(), distance_m: z.number() })
        .optional(),
    error: z.string().optional().nullable(),
});

export const TSPResponseSchema = z.object({
    ordered_destinations: z.array(
        z.object({ lat: z.number(), lon: z.number() })
    ),
    legs_between_stops: z.array(RouteResultSchema),
    total_time_sec: z.number(),
    total_fare_myr: z.number(),
    total_co2_grams: z.number(),
    reasoning: z.string(),
    error: z.string().optional().nullable(),
});

export type RouteResponse = z.infer<typeof RouteResponseSchema>;
export type TSPResponse = z.infer<typeof TSPResponseSchema>;
export type RouteResult = z.infer<typeof RouteResultSchema>;
