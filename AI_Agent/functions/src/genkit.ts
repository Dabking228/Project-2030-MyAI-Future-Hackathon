import { genkit } from "genkit";
import { vertexAI } from "@genkit-ai/google-genai";

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || "";
const LOCATION = process.env.GOOGLE_CLOUD_LOCATION || "us-central1";

export const RAG_CORPUS_NAME = process.env.RAG_CORPUS_NAME || "";

// Initialize the plugin first to access model references
const vertexPlugin = vertexAI({
    projectId: PROJECT_ID,
    location: LOCATION,
});

export const ai = genkit({
    plugins: [vertexPlugin],
    model: "vertexai/gemini-2.5-flash",
});

export const gemini25Flash = vertexPlugin.model("gemini-2.5-flash");

export const ragRetrievalConfig = RAG_CORPUS_NAME
    ? {
        vertexRetrieval: {
            datastore: {
                projectId: PROJECT_ID,
                location: LOCATION,
                collection: RAG_CORPUS_NAME,
            },
            disableAttribution: false,
        },
    }
    : undefined;
