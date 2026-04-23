import { onCallGenkit } from "firebase-functions/https";
import { setGlobalOptions } from "firebase-functions/v2";
import * as admin from "firebase-admin";

// Initialise Firebase Admin SDK
admin.initializeApp();

// Set global Cloud Function defaults
setGlobalOptions({
  region: "us-central1",
  memory: "1GiB",
  timeoutSeconds: 120,
});

// Import flows to register them with the Genkit instance
import { chatFlow } from "./flows/chatFlow";
import { parseIntentFlow } from "./flows/parseIntent";
import {
  formatSingleRouteFlow,
  formatTSPRouteFlow,
} from "./flows/formatResponse";

// Register tools (imported to register with ai instance)
import "./tools";

export const chat = onCallGenkit(
  {
    invoker: "public",
    cors: true,
  },
  chatFlow,
);

export const parseIntent = onCallGenkit(
  { invoker: "public", cors: true },
  parseIntentFlow,
);

export const formatSingleRoute = onCallGenkit(
  { invoker: "public", cors: true },
  formatSingleRouteFlow,
);

export const formatTSPRoute = onCallGenkit(
  { invoker: "public", cors: true },
  formatTSPRouteFlow,
);
