import { z } from "zod";
import { ai } from "../genkit";
import { parseIntentFlow } from "./parseIntent";
import {
    formatSingleRouteFlow,
    formatTSPRouteFlow,
} from "./formatResponse";
import {
    optimizeRouteTool,
    optimizeTSPRouteTool,
    searchTransitStopsTool,
} from "../tools";
import type { RouteResponse, TSPResponse } from "../schemas";

//  Chat I/O schemas

const MessageSchema = z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string(),
});

export const ChatInputSchema = z.object({
    message: z.string().describe("The user's latest message"),
    history: z
        .array(MessageSchema)
        .default([])
        .describe("Prior conversation turns for context"),
});

export const ChatOutputSchema = z.object({
    // Formatted text to show in the chat bubble
    text: z.string(),

    /**
     * Structured route data for the frontend's RouteResultsScreen.
     * null if this turn was a clarification or error.
     */
    routeData: z
        .object({
            type: z.enum(["single", "multi"]),
            recommended: z.any().nullable(),
            alternatives: z.array(z.any()).default([]),
            reasoning: z.string(),
            tspLegs: z.array(z.any()).optional(),
        })
        .nullable(),

    // The parsed intent
    intent: z.enum(["single_route", "multi_destination", "clarification_needed"]),
});

export type ChatInput = z.infer<typeof ChatInputSchema>;
export type ChatOutput = z.infer<typeof ChatOutputSchema>;

//  Orchestration prompt for the tool-calling step

const ORCHESTRATION_SYSTEM_PROMPT = `
You are SYBAR_AI, a helpful Malaysian public transport assistant.
You have access to tools that call a real route optimization backend.
Your job is to call the right tool with the correct parameters and
then let the formatter produce the final user message.
 
Rules:
- ALWAYS call a tool — never answer a routing question from memory
- For single origin → destination: use optimizeRoute
- For multiple destinations: use optimizeTSPRoute
- If a place name is ambiguous (multiple stops match): use searchTransitStops first
- Pass coordinates precisely (4+ decimal places)
- Never make up route data

CRITICAL INSTRUCTION:
When the tool returns its data, your final response MUST be exactly the raw JSON string returned by the tool. DO NOT add any conversational text, greetings, explanations, or markdown formatting (like \`\`\`json). Output ONLY the raw JSON.
`.trim();

//  Main chat flow

export const chatFlow = ai.defineFlow(
    {
        name: "chatFlow",
        inputSchema: ChatInputSchema,
        outputSchema: ChatOutputSchema,
    },
    async ({ message }): Promise<ChatOutput> => {

        // Parse intent
        const intent = await parseIntentFlow({ message });

        // Clarification needed
        if (intent.intent === "clarification_needed") {
            return {
                text: intent.clarification_prompt,
                routeData: null,
                intent: "clarification_needed",
            };
        }

        // Single route
        if (intent.intent === "single_route") {
            const toolPrompt =
                `Call the optimizeRoute tool with these parameters:
         Origin: ${intent.origin.place_name} (${intent.origin.lat}, ${intent.origin.lon})
         Destination: ${intent.destination.place_name} (${intent.destination.lat}, ${intent.destination.lon})
         Optimize for: ${intent.optimize_for}
         Return alternatives: ${intent.return_alternatives}`.trim();

            try {
                // ai.generate() automatically handles the tool call loop
                const toolResult = await ai.generate({
                    system: ORCHESTRATION_SYSTEM_PROMPT,
                    prompt: toolPrompt,
                    tools: [optimizeRouteTool, searchTransitStopsTool],
                    maxTurns: 3,
                    config: { temperature: 0 },
                });

                // Extract the tool response text (the JSON string our tool returned)
                const routeJson = _extractLastToolResponse(toolResult);

                const formattedText = await formatSingleRouteFlow({
                    routeData: routeJson,
                    userMessage: message,
                    optimizeFor: intent.optimize_for,
                });

                const routeData: RouteResponse = JSON.parse(routeJson);

                return {
                    text: formattedText,
                    intent: "single_route",
                    routeData: routeData.error
                        ? null
                        : {
                            type: "single",
                            recommended: routeData.recommended,
                            alternatives: routeData.alternatives ?? [],
                            reasoning: routeData.reasoning,
                        },
                };
            } catch (err: any) {
                console.error("[chatFlow] single_route tool error:", err);
                return {
                    text:
                        `I’m sorry, I couldn’t fetch the route right now. ` +
                        `The transit backend may be temporarily unreachable. ` +
                        `Please try again in a moment.\n\n_Error: ${err?.message ?? "Unknown error"}_`,
                    intent: "single_route",
                    routeData: null,
                };
            }
        }

        // Multi-destination (TSP)
        if (intent.intent === "multi_destination") {
            const destList = intent.destinations
                .map(
                    (d, i) =>
                        `  ${i + 1}. ${d.place_name} (${d.lat}, ${d.lon})`
                )
                .join("\n");

            const toolPrompt =
                `Call the optimizeTSPRoute tool with these parameters:
         Origin: ${intent.origin.place_name} (${intent.origin.lat}, ${intent.origin.lon})
         Destinations:
${destList}
         Optimize for: ${intent.optimize_for}
         Return to origin: ${intent.return_to_origin}`.trim();

            try {
                const toolResult = await ai.generate({
                    system: ORCHESTRATION_SYSTEM_PROMPT,
                    prompt: toolPrompt,
                    tools: [optimizeTSPRouteTool, searchTransitStopsTool],
                    maxTurns: 3,
                    config: { temperature: 0 },
                });

                const tspJson = _extractLastToolResponse(toolResult);
                const destinationNames = intent.destinations.map((d) => d.place_name);

                const formattedText = await formatTSPRouteFlow({
                    tspData: tspJson,
                    userMessage: message,
                    destinationNames,
                    optimizeFor: intent.optimize_for,
                });

                const tspData: TSPResponse = JSON.parse(tspJson);

                return {
                    text: formattedText,
                    intent: "multi_destination",
                    routeData: tspData.error
                        ? null
                        : {
                            type: "multi",
                            recommended: null,
                            alternatives: [],
                            reasoning: tspData.reasoning,
                            tspLegs: tspData.legs_between_stops,
                        },
                };
            } catch (err: any) {
                console.error("[chatFlow] multi_destination tool error:", err);
                return {
                    text:
                        `I’m sorry, I couldn’t plan the multi-destination route right now. ` +
                        `The transit backend may be temporarily unreachable. ` +
                        `Please try again in a moment.\n\n_Error: ${err?.message ?? "Unknown error"}_`,
                    intent: "multi_destination",
                    routeData: null,
                };
            }
        }

        // Unreachable — TypeScript exhaustiveness guard
        return {
            text: "I'm not sure how to help with that. Could you rephrase your transport question?",
            routeData: null,
            intent: "clarification_needed",
        };
    }
);

// Helper: extract the last tool response JSON from generate() result

function _extractLastToolResponse(generateResult: any): string {
    // 1. Most reliable: Extract directly from Genkit's internal tool response history
    try {
        const messages = generateResult.request?.messages || [];
        for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            if (msg.role === "tool" && Array.isArray(msg.content)) {
                for (const part of msg.content) {
                    if (part.toolResponse && part.toolResponse.output) {
                        const output = part.toolResponse.output;
                        return typeof output === "string" ? output : JSON.stringify(output);
                    }
                }
            }
        }
    } catch (e) {
        console.warn("Failed to extract tool response from history", e);
    }

    const text: string = generateResult.text ?? "{}";

    // 2. Try stripping markdown blocks
    try {
        const cleanText = text
            .replace(/^```json\s*/i, "")
            .replace(/^```\s*/, "")
            .replace(/\s*```$/, "")
            .trim();
        JSON.parse(cleanText);
        return cleanText;
    } catch { }

    // 3. Fallback to regex extraction
    const jsonMatch = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (jsonMatch) {
        try {
            JSON.parse(jsonMatch[0]);
            return jsonMatch[0];
        } catch {
            // Fall through
        }
    }

    return JSON.stringify({ error: "Could not parse route data from backend" });
}