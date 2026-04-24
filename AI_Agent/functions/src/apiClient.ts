import { RouteResponseSchema, TSPResponseSchema } from "./schemas";
import type { RouteResponse, TSPResponse } from "./schemas";
 
const BASE_URL =
  process.env.FASTAPI_BASE_URL ?? "http://localhost:8000/api/v1";

// Whether the backend is reached via localtunnel (needs bypass header)
const IS_LOCALTUNNEL = BASE_URL.includes(".loca.lt");

// Timeout for all requests — must be comfortably under the Cloud Function
// timeoutSeconds (120s). Graph path-finding + localtunnel RTT can be slow.
const TIMEOUT_MS = 85_000;

// Generic fetch wrapper

async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        // localtunnel shows a browser warning page unless this header is sent
        ...(IS_LOCALTUNNEL ? { "bypass-tunnel-reminder": "true" } : {}),
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `FastAPI error ${response.status} on ${path}: ${errorBody.slice(0, 300)}`
      );
    }

    return (await response.json()) as T;
  } catch (err: any) {
    if (err.name === "AbortError") {
      throw new Error(
        `Request to ${path} timed out after ${TIMEOUT_MS / 1000}s. ` +
        `Check that FASTAPI_BASE_URL (${BASE_URL}) is reachable and the backend is running.`
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
 
// Route optimization

export interface SingleRouteParams {
  origin: { lat: number; lon: number };
  destination: { lat: number; lon: number };
  optimize_for: "time" | "cost" | "eco";
  return_alternatives: boolean;
}
 
export async function fetchOptimizedRoute(
  params: SingleRouteParams
): Promise<RouteResponse> {
  const raw = await apiFetch<unknown>("/route", {
    method: "POST",
    body: JSON.stringify(params),
  });
  return RouteResponseSchema.parse(raw);
}
 
// TSP multi-destination

export interface TSPParams {
  origin: { lat: number; lon: number };
  destinations: Array<{ lat: number; lon: number }>;
  optimize_for: "time" | "cost" | "eco";
  return_to_origin: boolean;
}
 
export async function fetchTSPRoute(params: TSPParams): Promise<TSPResponse> {
  const raw = await apiFetch<unknown>("/route/tsp", {
    method: "POST",
    body: JSON.stringify(params),
  });
  return TSPResponseSchema.parse(raw);
}
 
// Stop search (used for clarification flows)

export interface StopInfo {
  id: string;
  name: string;
  distance_m: number;
}
 
export async function fetchNearestStops(
  lat: number,
  lon: number,
  topN = 3
): Promise<StopInfo[]> {
  return apiFetch<StopInfo[]>(
    `/stops/nearest?lat=${lat}&lon=${lon}&top_n=${topN}`
  );
}
 
export async function fetchStopsByName(
  query: string,
  topN = 5
): Promise<StopInfo[]> {
  return apiFetch<StopInfo[]>(
    `/stops/search?q=${encodeURIComponent(query)}&top_n=${topN}`
  );
}