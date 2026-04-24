import { z } from "zod";
import { ai, ragRetrievalConfig } from "../genkit";
import type { RouteResponse, TSPResponse } from "../schemas";

// Format single route

export const formatSingleRouteFlow = ai.defineFlow(
    {
        name: "formatSingleRoute",
        inputSchema: z.object({
            routeData: z.string().describe("JSON string of the RouteResponse"),
            userMessage: z.string().describe("The original user question"),
            optimizeFor: z.enum(["time", "cost", "eco"]),
        }),
        outputSchema: z.string(),
    },
    async ({ routeData, userMessage, optimizeFor }): Promise<string> => {
        const route: RouteResponse = JSON.parse(routeData);

        // If the backend returned an error, surface it gracefully
        if (route.error || !route.recommended) {
            return (
                `Sorry, I couldn't find a public transport route for your request. ` +
                `${route.error ?? "No route was found between those locations."} ` +
                `Could you double-check the places you mentioned?`
            );
        }

        const rec = route.recommended;
        const timeMin = Math.round(rec.total_time_sec / 60);
        const fare = rec.total_fare_myr.toFixed(2);
        const co2Saved = Math.round(rec.co2_saved_grams);
        const instructions = rec.instructions.join("\n");
        const altCount = route.alternatives?.length ?? 0;

        const systemPrompt = `
You are a helpful Malaysian public transport assistant. 
Format route information clearly and conversationally for a mobile chat interface.
Use Markdown: **bold** for key figures, emoji for modes (🚆 train, 🚌 bus, 🚶 walking).
Be concise but complete. Do not invent any information — only use what is provided.
`.trim();

        const dataPrompt = `
User asked: "${userMessage}"
Optimizing for: ${optimizeFor}

RECOMMENDED ROUTE:
- From: ${route.origin_stop?.name ?? "Origin"}
- To: ${route.destination_stop?.name ?? "Destination"}
- Travel time: ${timeMin} minutes
- Fare: RM ${fare}
- CO₂ emissions: ${Math.round(rec.total_co2_grams)}g (saves ${co2Saved}g vs driving)
- Distance: ${rec.total_distance_km.toFixed(1)} km

STEP-BY-STEP INSTRUCTIONS:
${instructions}

OPTIMIZER REASONING:
${route.reasoning}

ALTERNATIVES AVAILABLE: ${altCount > 0 ? `${altCount} alternative route(s) found` : "None"}
${altCount > 0
                ? route.alternatives
                    .map(
                        (alt, i) =>
                            `Alternative ${i + 1} (${alt.objective}-optimized): ` +
                            `${Math.round(alt.total_time_sec / 60)} min, RM ${alt.total_fare_myr.toFixed(2)}`,
                    )
                    .join("\n")
                : ""
            }

${rec.carbon
                ? `CARBON BREAKDOWN:
- Rail: ${rec.carbon.breakdown_by_mode.rail_co2_grams ?? 0}g CO₂
- Bus: ${rec.carbon.breakdown_by_mode.bus_co2_grams ?? 0}g CO₂  
- You save ${rec.carbon.co2_saved_percent}% compared to driving
- Equivalent to ${rec.carbon.equivalent_tree_days} days of tree CO₂ absorption`
                : ""
            }

Write a friendly, well-formatted chat response that:
1. Gives the total journey time and cost
2. Provides the FULL step-by-step instructions without omitting any stops
3. Mentions the CO₂ benefit
End with a brief encouragement to use public transport.
`.trim();

        const result = await ai.generate({
            system: systemPrompt,
            prompt: dataPrompt,
            ...(ragRetrievalConfig
                ? { config: { ...ragRetrievalConfig, temperature: 0.4 } }
                : { config: { temperature: 0.4 } }),
        });

        return result.text;
    },
);

// Format TSP (multi-destination) route

export const formatTSPRouteFlow = ai.defineFlow(
    {
        name: "formatTSPRoute",
        inputSchema: z.object({
            tspData: z.string().describe("JSON string of the TSPResponse"),
            userMessage: z.string().describe("The original user question"),
            destinationNames: z
                .array(z.string())
                .describe("Names of the destinations in the original request order"),
            optimizeFor: z.enum(["time", "cost", "eco"]),
        }),
        outputSchema: z.string(),
    },
    async ({
        tspData,
        userMessage,
        destinationNames,
        optimizeFor,
    }): Promise<string> => {
        const tsp: TSPResponse = JSON.parse(tspData);

        if (tsp.error || !tsp.legs_between_stops?.length) {
            return (
                `Sorry, I couldn't plan a multi-destination route for your request. ` +
                `${tsp.error ?? "No route was found."} ` +
                `Try reducing the number of destinations or checking the place names.`
            );
        }

        const timeMin = Math.round(tsp.total_time_sec / 60);
        const fare = tsp.total_fare_myr.toFixed(2);

        // Build per-leg summary
        const legSummaries = tsp.legs_between_stops
            .map((leg, i) => {
                const legMin = Math.round(leg.total_time_sec / 60);
                const allInstructions = leg.instructions.join("\n  - ");
                return `Leg ${i + 1} (Total: ~${legMin} min, RM ${leg.total_fare_myr.toFixed(2)}):\n  - ${allInstructions}`;
            })
            .join("\n\n");

        const systemPrompt = `
You are a helpful Malaysian public transport assistant.
Format multi-destination route plans clearly for a mobile chat interface.
Use Markdown, emojis for transport modes, and number each destination stop.
Be clear about the optimal visit ORDER since that's the key value here.
Do not invent any information — only use what is provided.
`.trim();

        const dataPrompt = `
User asked: "${userMessage}"
Original destinations requested: ${destinationNames.join(", ")}
Optimizing for: ${optimizeFor}

OPTIMAL VISIT ORDER (computed by TSP solver):
${tsp.ordered_destinations.map((d, i) => `${i + 1}. Destination at (${d.lat.toFixed(4)}, ${d.lon.toFixed(4)})`).join("\n")}

JOURNEY TOTALS:
- Total travel time: ${timeMin} minutes
- Total fare: RM ${fare}
- Total CO₂: ${Math.round(tsp.total_co2_grams)}g

PER-LEG DETAILS:
${legSummaries}

TSP SOLVER REASONING:
${tsp.reasoning}

Write a friendly chat response that:
1. Tells the user the optimal visit ORDER clearly
2. Gives total journey time and cost
3. Provides the full step-by-step instructions for each leg
4. Mentions the CO₂ benefit
`.trim();

        const result = await ai.generate({
            system: systemPrompt,
            prompt: dataPrompt,
            ...(ragRetrievalConfig
                ? { config: { ...ragRetrievalConfig, temperature: 0.4 } }
                : { config: { temperature: 0.4 } }),
        });

        return result.text;
    },
);
