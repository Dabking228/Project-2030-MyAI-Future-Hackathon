import { RouteResponseSchema, TSPResponseSchema } from "./schemas";
import type { RouteResponse, TSPResponse } from "./schemas";
 
const BASE_URL =
  process.env.FASTAPI_BASE_URL ?? "http://localhost:8000/api/v1";
 
// Timeout for all requests (ms)
const TIMEOUT_MS = 30_000;
 
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
        ...options.headers,
      },
    });
 
    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `FastAPI error ${response.status} on ${path}: ${errorBody}`
      );
    }
 
    return (await response.json()) as T;
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