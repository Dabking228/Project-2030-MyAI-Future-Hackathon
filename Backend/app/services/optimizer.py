import logging
from typing import Dict, List, Optional, Any

import networkx as nx

from app.config import settings
from app.services.routing import extract_path_details, find_nearest_stops

logger = logging.getLogger(__name__)

OBJECTIVE_WEIGHT_MAP = {
    "time": settings.WEIGHT_TRAVEL_TIME,
    "cost": settings.WEIGHT_FARE,
    "eco": settings.WEIGHT_EMISSIONS,
}

def optimize_route(
    graph: nx.MultiDiGraph,
    origin_lat: float,
    origin_lon: float,
    dest_lat: float,
    dest_lon: float,
    objective: str = "time",
    return_alternatives: bool = True,
) -> Dict[str, Any]:

    from app.services.realtime import realtime_manager

    graph = realtime_manager.apply_realtime_overlay(graph)

    origin_stops = find_nearest_stops(graph, origin_lat, origin_lon, top_n=3)
    dest_stops = find_nearest_stops(graph, dest_lat, dest_lon, top_n=3)

    if not origin_stops:
        return _error("No transit stop found near your origin location.")
    if not dest_stops:
        return _error("No transit stop found near your destination.")

    origin_id = origin_stops[0][0]
    dest_id = dest_stops[0][0]

    if origin_id == dest_id:
        return _error("Origin and destination are the same stop.")

    primary_weight = OBJECTIVE_WEIGHT_MAP.get(objective, settings.WEIGHT_TRAVEL_TIME)
    primary_path = _dijkstra(graph, origin_id, dest_id, primary_weight)

    if primary_path is None:
        return _error("No route found between these locations.")

    recommended = extract_path_details(graph, primary_path)
    recommended["objective"] = objective

    alternatives = []
    if return_alternatives:
        other_objectives = [o for o in OBJECTIVE_WEIGHT_MAP if o != objective]
        seen_paths = {tuple(primary_path)}

        for alt_obj in other_objectives:
            alt_weight = OBJECTIVE_WEIGHT_MAP[alt_obj]
            alt_path = _dijkstra(graph, origin_id, dest_id, alt_weight)
            if alt_path and tuple(alt_path) not in seen_paths:
                alt_details = extract_path_details(graph, alt_path)
                alt_details["objective"] = alt_obj
                alternatives.append(alt_details)
                seen_paths.add(tuple(alt_path))

    reasoning = _build_reasoning(recommended, alternatives, objective)

    return {
        "recommended": recommended,
        "alternatives": alternatives,
        "reasoning": reasoning,
        "origin_stop": {
            "id": origin_id,
            "name": graph.nodes[origin_id].get("name", origin_id),
            "distance_m": origin_stops[0][1],
        },
        "destination_stop": {
            "id": dest_id,
            "name": graph.nodes[dest_id].get("name", dest_id),
            "distance_m": dest_stops[0][1],
        },
    }

def _dijkstra(
    graph: nx.MultiDiGraph,
    source: str,
    target: str,
    weight: str,
) -> Optional[List[str]]:
    try:
        path = nx.dijkstra_path(graph, source, target, weight=weight)
        return path
    except nx.NetworkXNoPath:
        logger.warning(
            "No path found from %s to %s using weight=%s", source, target, weight
        )
        return None
    except nx.NodeNotFound as e:
        logger.warning("Node not found: %s", e)
        return None

def _build_reasoning(
    recommended: Dict,
    alternatives: List[Dict],
    objective: str,
) -> str:
    time_min = recommended["total_time_sec"] // 60
    fare = recommended["total_fare_myr"]
    co2 = recommended["total_co2_grams"]
    co2_saved = recommended["co2_saved_grams"]

    base = (
        f"The recommended route was optimized for **{objective}**. "
        f"It takes approximately {time_min} minutes, costs RM {fare:.2f}, "
        f"and produces {co2:.0f} g of CO₂ "
        f"(saving {co2_saved:.0f} g compared to driving)."
    )

    if alternatives:
        comparisons = []
        for alt in alternatives:
            alt_time = alt["total_time_sec"] // 60
            alt_fare = alt["total_fare_myr"]
            alt_obj = alt["objective"]
            comparisons.append(
                f"the {alt_obj}-optimized alternative takes {alt_time} min and costs RM {alt_fare:.2f}"
            )
        base += " For comparison, " + "; ".join(comparisons) + "."

    return base

def _error(msg: str) -> Dict[str, Any]:
    return {"error": msg, "recommended": None, "alternatives": [], "reasoning": ""}
