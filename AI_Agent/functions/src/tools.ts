import { z } from "zod";
import { ai } from "./genkit";
import {
  fetchOptimizedRoute,
  fetchStopsByName,
  fetchTSPRoute,
} from "./apiClient";

export const optimizeRouteTool = ai.defineTool(
  {
    name: "optimizeRoute",
    description:
      "Find the most optimized public transport route between two locations in Malaysia. " +
      "Use this when the user wants to travel from a single origin to a single destination. " +
      "Accepts lat/lon coordinates and an optimization goal (time, cost, or eco). " +
      "Returns step-by-step transit instructions, total fare, travel time, and carbon savings.",
    inputSchema: z.object({
      origin_lat: z.number().describe("Latitude of the starting point"),
      origin_lon: z.number().describe("Longitude of the starting point"),
      destination_lat: z.number().describe("Latitude of the destination"),
      destination_lon: z.number().describe("Longitude of the destination"),
      optimize_for: z
        .enum(["time", "cost", "eco"])
        .describe("What to optimize: 'time' = fastest, 'cost' = cheapest, 'eco' = lowest emissions"),
      return_alternatives: z
        .boolean()
        .default(true)
        .describe("Whether to also return alternative routes"),
    }),
    outputSchema: z.string().describe("JSON string of the route result"),
  },
  async (input) => {
    const result = await fetchOptimizedRoute({
      origin: { lat: input.origin_lat, lon: input.origin_lon },
      destination: { lat: input.destination_lat, lon: input.destination_lon },
      optimize_for: input.optimize_for,
      return_alternatives: input.return_alternatives,
    });

    if (result.error) {
      return JSON.stringify({ error: result.error });
    }

    return JSON.stringify(result);
  }
);

export const optimizeTSPRouteTool = ai.defineTool(
  {
    name: "optimizeTSPRoute",
    description:
      "Find the optimal visit order and public transport route for MULTIPLE destinations in Malaysia. " +
      "Use this when the user wants to visit 2 or more places and wants the most efficient order. " +
      "Powered by OR-Tools TSP solver. " +
      "Returns the optimized visit sequence and full route instructions for each leg.",
    inputSchema: z.object({
      origin_lat: z.number().describe("Latitude of the starting point"),
      origin_lon: z.number().describe("Longitude of the starting point"),
      destinations: z
        .array(
          z.object({
            lat: z.number(),
            lon: z.number(),
            place_name: z.string().describe("Name of this destination"),
          })
        )
        .min(2)
        .max(10)
        .describe("List of destinations to visit"),
      optimize_for: z
        .enum(["time", "cost", "eco"])
        .describe("What to optimize for across the whole journey"),
      return_to_origin: z
        .boolean()
        .default(false)
        .describe("Whether the route should loop back to the start"),
    }),
    outputSchema: z.string().describe("JSON string of the TSP route result"),
  },
  async (input) => {
    const result = await fetchTSPRoute({
      origin: { lat: input.origin_lat, lon: input.origin_lon },
      destinations: input.destinations.map((d) => ({
        lat: d.lat,
        lon: d.lon,
      })),
      optimize_for: input.optimize_for,
      return_to_origin: input.return_to_origin,
    });

    if (result.error) {
      return JSON.stringify({ error: result.error });
    }

    return JSON.stringify(result);
  }
);

export const searchTransitStopsTool = ai.defineTool(
  {
    name: "searchTransitStops",
    description:
      "Search for Malaysian public transit stops by name. " +
      "Use this ONLY when a location name is ambiguous and you need to confirm " +
      "the exact stop before routing. For example if the user says 'Bangsar' " +
      "and there are multiple Bangsar stops across different lines. " +
      "Returns a list of matching stop names and IDs.",
    inputSchema: z.object({
      query: z
        .string()
        .describe("The stop name or partial name to search for"),
      top_n: z
        .number()
        .int()
        .min(1)
        .max(10)
        .default(5)
        .describe("Maximum number of results to return"),
    }),
    outputSchema: z
      .string()
      .describe("JSON array of matching stops with id, name, and distance"),
  },
  async (input) => {
    const stops = await fetchStopsByName(input.query, input.top_n);
    return JSON.stringify(stops);
  }
);

// Exported as an array for easy inclusion in ai.generate() calls
export const ALL_TOOLS = [
  optimizeRouteTool,
  optimizeTSPRouteTool,
  searchTransitStopsTool,
];