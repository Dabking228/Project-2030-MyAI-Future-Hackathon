import logging
from math import radians, sin, cos, sqrt, atan2
from typing import List, Optional, Tuple, Dict, Any

import networkx as nx
import pandas as pd

from app.config import settings

logger = logging.getLogger(__name__)

def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6_371_000
    phi1, phi2 = radians(lat1), radians(lat2)
    dphi = radians(lat2 - lat1)
    dlam = radians(lon2 - lon1)
    a = sin(dphi / 2) ** 2 + cos(phi1) * cos(phi2) * sin(dlam / 2) ** 2
    return R * 2 * atan2(sqrt(a), sqrt(1 - a))

def find_nearest_stops(
    graph: nx.MultiDiGraph,
    lat: float,
    lon: float,
    top_n: int = 3,
    max_distance_m: float = 1500.0,
) -> List[Tuple[str, float]]:
    candidates = []
    for node, attrs in graph.nodes(data=True):
        node_lat = attrs.get("lat")
        node_lon = attrs.get("lon")
        if node_lat is None or node_lon is None:
            continue
        dist = haversine_m(lat, lon, node_lat, node_lon)
        if dist <= max_distance_m:
            candidates.append((node, dist))

    candidates.sort(key=lambda x: x[1])
    return candidates[:top_n]


def find_stops_by_name(
    graph: nx.MultiDiGraph,
    name_query: str,
    top_n: int = 5,
) -> List[Tuple[str, str]]:
    q = name_query.lower()
    results = []
    for node, attrs in graph.nodes(data=True):
        stop_name = attrs.get("name", "")
        if q in stop_name.lower():
            results.append((node, stop_name))
    return results[:top_n]

def extract_path_details(
    graph: nx.MultiDiGraph,
    node_path: List[str],
) -> Dict[str, Any]:
    legs = []
    total_time = 0
    total_fare = 0.0
    total_co2 = 0.0
    total_dist = 0.0
    current_trip_id = None

    for i in range(len(node_path) - 1):
        from_id = node_path[i]
        to_id = node_path[i + 1]

        # Pick the best edge (lowest travel time), preferring to stay on the same trip
        best_edge = _pick_best_edge(graph, from_id, to_id, current_trip_id)
        if best_edge is None:
            continue

        from_name = graph.nodes[from_id].get("name", from_id)
        to_name = graph.nodes[to_id].get("name", to_id)
        from_lat = graph.nodes[from_id].get("lat")
        from_lon = graph.nodes[from_id].get("lon")
        to_lat = graph.nodes[to_id].get("lat")
        to_lon = graph.nodes[to_id].get("lon")

        leg = {
            "from_stop_id": from_id,
            "from_stop_name": from_name,
            "from_stop_lat": from_lat,
            "from_stop_lon": from_lon,
            "to_stop_id": to_id,
            "to_stop_name": to_name,
            "to_stop_lat": to_lat,
            "to_stop_lon": to_lon,
            "trip_id": best_edge.get("trip_id", ""),
            "route_id": best_edge.get("route_id", ""),
            "agency_type": best_edge.get("agency_type", ""),
            "edge_type": best_edge.get("edge_type", "transit"),
            "departure_time": best_edge.get("departure_time", ""),
            "arrival_time": best_edge.get("arrival_time", ""),
            "travel_time_sec": best_edge.get("travel_time_sec", 0),
            "fare_myr": best_edge.get("fare_myr", 0.0),
            "co2_grams": best_edge.get("co2_grams", 0.0),
            "distance_km": best_edge.get("distance_km", 0.0),
        }
        legs.append(leg)

        # Accumulate fare: rail fares are distance-based per segment, bus is flat per trip
        if leg["edge_type"] != "walk":
            if leg["agency_type"] == "rail":
                total_fare += leg["fare_myr"]
            elif leg["trip_id"] != current_trip_id:
                total_fare += leg["fare_myr"]

        current_trip_id = leg["trip_id"]

        total_time += leg["travel_time_sec"]
        total_co2 += leg["co2_grams"]
        total_dist += leg["distance_km"]

    # Group consecutive legs with the same trip into a single instruction
    instructions = _build_instructions(legs)

    # Calculate car CO₂ for comparison
    car_co2 = settings.CO2_CAR_PER_KM * total_dist
    co2_saved = car_co2 - total_co2

    return {
        "legs": legs,
        "total_time_sec": total_time,
        "total_fare_myr": round(total_fare, 2),
        "total_co2_grams": round(total_co2, 1),
        "total_distance_km": round(total_dist, 2),
        "car_co2_grams": round(car_co2, 1),
        "co2_saved_grams": round(co2_saved, 1),
        "instructions": instructions,
    }


def _pick_best_edge(
    graph: nx.MultiDiGraph,
    from_id: str,
    to_id: str,
    preferred_trip_id: Optional[str] = None,
) -> Optional[Dict]:
    """Return the edge with the lowest travel_time_sec, preferring preferred_trip_id."""
    edge_data = graph.get_edge_data(from_id, to_id)
    if not edge_data:
        return None
        
    # If the preferred trip continues on this edge, use it to avoid unnecessary interchanges
    if preferred_trip_id:
        for e in edge_data.values():
            if e.get("trip_id") == preferred_trip_id:
                return e

    # Otherwise fallback to the edge with the lowest travel time
    best = min(
        edge_data.values(),
        key=lambda e: e.get("travel_time_sec", float("inf")),
    )
    return best


def _build_instructions(legs: List[Dict]) -> List[str]:
    if not legs:
        return []

    instructions = []
    i = 0

    while i < len(legs):
        leg = legs[i]

        if leg["edge_type"] == "walk":
            walk_min = max(1, leg["travel_time_sec"] // 60)
            instructions.append(f"🚶 Walk to {leg['to_stop_name']} (~{walk_min} min)")
            i += 1
            continue

        # Group consecutive transit legs on the same trip
        trip_id = leg["trip_id"]
        route_id = leg["route_id"]
        board_at = leg["from_stop_name"]
        alight_at = leg["to_stop_name"]
        trip_time = leg["travel_time_sec"]

        j = i + 1
        while j < len(legs) and legs[j]["trip_id"] == trip_id:
            alight_at = legs[j]["to_stop_name"]
            trip_time += legs[j]["travel_time_sec"]
            j += 1

        mode_icon = _mode_icon(leg["agency_type"])
        total_min = max(1, trip_time // 60)
        route_name = _short_route_id(route_id)

        instructions.append(
            f"{mode_icon} Board {route_name} at {board_at}, "
            f"ride to {alight_at} (~{total_min} min)"
        )

        # Check if there is a need to signal an interchange
        if j < len(legs) and legs[j]["edge_type"] != "walk":
            instructions.append(f"🔄 Interchange at {alight_at}")

        i = j

    return instructions


def _mode_icon(agency_type: str) -> str:
    icons = {"rail": "🚆", "bus": "🚌", "walk": "🚶"}
    return icons.get(agency_type, "🚌")


def _short_route_id(route_id: str) -> str:
    return route_id.split(":")[-1] if ":" in route_id else route_id
