import logging
from typing import Dict, List, Optional, Tuple, Any

import networkx as nx

from app.config import settings
from app.services.optimizer import _dijkstra, OBJECTIVE_WEIGHT_MAP
from app.services.routing import extract_path_details, find_nearest_stops

logger = logging.getLogger(__name__)

def solve_tsp(
    graph: nx.MultiDiGraph,
    origin_lat: float,
    origin_lon: float,
    destinations: List[Tuple[float, float]],
    objective: str = "time",
    return_to_origin: bool = False,
) -> Dict[str, Any]:
    try:
        from ortools.constraint_solver import routing_enums_pb2
        from ortools.constraint_solver import pywrapcp
    except ImportError:
        return _error("OR-Tools is not installed. Run: pip install ortools")

    all_coords = [(origin_lat, origin_lon)] + list(destinations)
    stop_ids: List[Optional[str]] = []

    for lat, lon in all_coords:
        nearest = find_nearest_stops(graph, lat, lon, top_n=1)
        if not nearest:
            return _error(f"No transit stop found near ({lat}, {lon})")
        stop_ids.append(nearest[0][0])

    n = len(stop_ids)
    weight_key = OBJECTIVE_WEIGHT_MAP.get(objective, settings.WEIGHT_TRAVEL_TIME)

    logger.info("Building %dx%d cost matrix for TSP …", n, n)
    cost_matrix = _build_cost_matrix(graph, stop_ids, weight_key)

    manager = pywrapcp.RoutingIndexManager(n, 1, 0) # n nodes, 1 vehicle, depot=0
    routing = pywrapcp.RoutingModel(manager)

    def distance_callback(from_index, to_index):
        from_node = manager.IndexToNode(from_index)
        to_node = manager.IndexToNode(to_index)
        return cost_matrix[from_node][to_node]

    transit_cb_index = routing.RegisterTransitCallback(distance_callback)
    routing.SetArcCostEvaluatorOfAllVehicles(transit_cb_index)

    search_params = pywrapcp.DefaultRoutingSearchParameters()
    search_params.first_solution_strategy = (
        routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    )
    search_params.local_search_metaheuristic = (
        routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    )
    search_params.time_limit.seconds = 10  # Max solver time

    solution = routing.SolveWithParameters(search_params)

    if not solution:
        return _error("OR-Tools could not find a solution for these destinations.")

    visit_order: List[int] = []
    index = routing.Start(0)
    while not routing.IsEnd(index):
        visit_order.append(manager.IndexToNode(index))
        index = solution.Value(routing.NextVar(index))
    if return_to_origin:
        visit_order.append(0)

    logger.info("TSP visit order: %s", visit_order)

    legs_between_stops = []
    total_time = 0
    total_fare = 0.0
    total_co2 = 0.0

    for i in range(len(visit_order) - 1):
        from_stop = stop_ids[visit_order[i]]
        to_stop = stop_ids[visit_order[i + 1]]

        path = _dijkstra(graph, from_stop, to_stop, weight_key)
        if path:
            details = extract_path_details(graph, path)
            details["objective"] = objective
            legs_between_stops.append(details)
            total_time += details["total_time_sec"]
            total_fare += details["total_fare_myr"]
            total_co2 += details["total_co2_grams"]
        else:
            logger.warning("No path found between %s and %s", from_stop, to_stop)

    ordered_dest_coords = [
        {"lat": all_coords[visit_order[i]][0], "lon": all_coords[visit_order[i]][1]}
        for i in range(1, len(visit_order))
        if visit_order[i] != 0
    ]

    reasoning = (
        f"OR-Tools found the optimal visit order for {len(destinations)} destinations "
        f"optimized for **{objective}**. "
        f"Total journey: ~{total_time // 60} minutes, "
        f"RM {total_fare:.2f}, {total_co2:.0f} g CO₂."
    )

    return {
        "ordered_destinations": ordered_dest_coords,
        "legs_between_stops": legs_between_stops,
        "total_time_sec": total_time,
        "total_fare_myr": round(total_fare, 2),
        "total_co2_grams": round(total_co2, 1),
        "reasoning": reasoning,
    }

def _build_cost_matrix(
    graph: nx.MultiDiGraph,
    stop_ids: List[str],
    weight_key: str,
) -> List[List[int]]:
    import math

    n = len(stop_ids)
    matrix = [[0] * n for _ in range(n)]

    for i in range(n):
        for j in range(n):
            if i == j:
                matrix[i][j] = 0
                continue
            try:
                cost = nx.dijkstra_path_length(
                    graph, stop_ids[i], stop_ids[j], weight=weight_key
                )

                if weight_key == settings.WEIGHT_FARE:
                    matrix[i][j] = int(cost * 100)
                else:
                    matrix[i][j] = int(math.ceil(cost))
            except (nx.NetworkXNoPath, nx.NodeNotFound):
                matrix[i][j] = 999_999

    return matrix


def _error(msg: str) -> Dict[str, Any]:
    return {
        "error": msg,
        "ordered_destinations": [],
        "legs_between_stops": [],
        "total_time_sec": 0,
        "total_fare_myr": 0.0,
        "total_co2_grams": 0.0,
        "reasoning": "",
    }
