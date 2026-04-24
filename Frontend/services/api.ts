import { Platform } from "react-native";
import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase";

// FastAPI base URL — direct REST calls for non-AI endpoints
const LOCALHOST        = Platform.OS === 'android' ? '10.0.2.2' : 'localhost';
const FASTAPI_BASE_URL = process.env.EXPO_PUBLIC_FASTAPI_URL ?? `http://${LOCALHOST}:8000/api/v1`;

const TIMEOUT_MS = 60_000;

// Types matching ChatOutput from AI_Agent/functions/src/flows/chatFlow.ts
// Mirrors AI_Agent/functions/src/schemas.ts)

export interface RouteLeg {
  from_stop_name: string;
  from_stop_lat?: number | null;
  from_stop_lon?: number | null;
  to_stop_name: string;
  to_stop_lat?: number | null;
  to_stop_lon?: number | null;
  agency_type: "rail" | "bus" | "walk";
  edge_type: "transit" | "walk";
  departure_time?: string;
  arrival_time?: string;
  travel_time_sec: number;
  fare_myr: number;
  co2_grams: number;
  distance_km: number;
  route_id: string;
  trip_id: string;
}

export interface CarbonSummary {
  total_transit_co2_grams: number;
  car_baseline_co2_grams: number;
  co2_saved_grams: number;
  co2_saved_percent: number;
  equivalent_tree_days: number;
  total_distance_km: number;
  breakdown_by_mode: Record<string, number>;
}

export interface RouteResult {
  legs: RouteLeg[];
  total_time_sec: number;
  total_fare_myr: number;
  total_co2_grams: number;
  total_distance_km: number;
  car_co2_grams: number;
  co2_saved_grams: number;
  instructions: string[];
  objective: string;
  carbon?: CarbonSummary;
}

export interface RouteData {
  type: "single" | "multi";
  recommended: RouteResult | null;
  alternatives: RouteResult[];
  reasoning: string;
  tspLegs?: RouteResult[];
}

export interface ChatResponse {
  text: string;
  routeData: RouteData | null;
  intent: "single_route" | "multi_destination" | "clarification_needed";
}

export interface StopInfo {
  id: string;
  name: string;
  distance_m: number;
}

export interface VehiclePosition {
  vehicle_id: string;
  trip_id: string;
  route_id: string;
  lat: number;
  lon: number;
  timestamp: number;
  current_stop_sequence: number;
  current_status: string;
}

//  Firebase callable — chatFlow

/**
 * Call the `chat` Cloud Function (wraps chatFlow via onCallGenkit).
 * The Firebase SDK automatically attaches auth headers.
 * Falls back gracefully on network error.
 */
export async function sendChatMessage(
  message: string,
  history: { role: "user" | "assistant"; content: string }[],
): Promise<ChatResponse> {
  const callChat = httpsCallable<
    { message: string; history: typeof history },
    ChatResponse
  >(functions, "chat"); // 'chat' = the export name in AI_Agent/src/index.ts

  const result = await callChat({ message, history });
  return result.data;
}

// FastAPI direct calls
async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${FASTAPI_BASE_URL}${path}`, {
      ...options,
      signal: controller.signal,
      headers: { "Content-Type": "application/json", ...options.headers },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`HTTP ${res.status}: ${body}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

// Stops — calls FastAPI directly
export async function getNearestStops(
  lat: number,
  lon: number,
  topN = 3,
): Promise<StopInfo[]> {
  return apiFetch<StopInfo[]>(
    `${FASTAPI_BASE_URL}/stops/nearest?lat=${lat}&lon=${lon}&top_n=${topN}`,
  );
}

// Realtime vehicles — calls FastAPI
export async function getRealtimeVehicles(
  feed?: string,
): Promise<Record<string, VehiclePosition[]>> {
  const params = feed ? `?feed=${feed}` : "";
  const res = await apiFetch<{
    feeds: Record<string, VehiclePosition[]>;
    total_vehicles: number;
  }>(`${FASTAPI_BASE_URL}/realtime/vehicles${params}`);
  return res.feeds;
}
