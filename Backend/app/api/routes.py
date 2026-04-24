import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.models.schemas import (
    GraphStatsResponse,
    RealtimeStatusResponse,
    RouteRequest,
    RouteResponse,
    StopInfo,
    TSPRequest,
    TSPResponse,
)
from app.services.carbon import calculate_route_carbon
from app.services.optimizer import optimize_route
from app.services.routing import find_nearest_stops, find_stops_by_name
from app.services.tsp_solver import solve_tsp

router = APIRouter()
logger = logging.getLogger(__name__)


# Dependency: get graph from app state
def get_app_state(request: Request):
    state = getattr(request.app.state, "gtfs", None)
    if state is None or state.graph.number_of_nodes() == 0:
        raise HTTPException(
            status_code=503, detail="GTFS data not yet loaded. Please retry shortly."
        )
    return state

# Route optimization
@router.post("/route", response_model=RouteResponse)
async def route_optimize(
    body: RouteRequest,
    state=Depends(get_app_state),
):
    """
    Find the most optimized public transport route between two coordinates.
    Accepts an optimization objective: 'time', 'cost', or 'eco'.
    Returns the recommended route plus up to 2 alternatives.
    """
    result = optimize_route(
        graph=state.graph,
        origin_lat=body.origin.lat,
        origin_lon=body.origin.lon,
        dest_lat=body.destination.lat,
        dest_lon=body.destination.lon,
        objective=body.optimize_for,
        return_alternatives=body.return_alternatives,
    )

    if result.get("error"):
        return RouteResponse(
            recommended=None,
            alternatives=[],
            reasoning="",
            error=result["error"],
        )

    # Enrich recommended route with full carbon summary
    if result["recommended"] and result["recommended"].get("legs"):
        result["recommended"]["carbon"] = calculate_route_carbon(
            result["recommended"]["legs"]
        )

    # Enrich alternatives with carbon summary
    for alt in result.get("alternatives", []):
        if alt.get("legs"):
            alt["carbon"] = calculate_route_carbon(alt["legs"])

    return RouteResponse(**result)


# TSP multi-destination
@router.post("/route/tsp", response_model=TSPResponse)
async def route_tsp(
    body: TSPRequest,
    state=Depends(get_app_state),
):
    """
    Solve the Traveling Salesman Problem for multiple destinations.
    Returns the optimal visit order and the full route for each leg.
    """
    result = solve_tsp(
        graph=state.graph,
        origin_lat=body.origin.lat,
        origin_lon=body.origin.lon,
        destinations=[(d.lat, d.lon) for d in body.destinations],
        objective=body.optimize_for,
        return_to_origin=body.return_to_origin,
    )

    if result.get("error"):
        return TSPResponse(
            ordered_destinations=[],
            legs_between_stops=[],
            total_time_sec=0,
            total_fare_myr=0.0,
            total_co2_grams=0.0,
            reasoning="",
            error=result["error"],
        )

    for leg_group in result.get("legs_between_stops", []):
        if leg_group.get("legs"):
            leg_group["carbon"] = calculate_route_carbon(leg_group["legs"])

    return TSPResponse(**result)

# Stop finders
@router.get("/stops/nearest", response_model=List[StopInfo])
async def nearest_stops(
    lat: float = Query(..., description="Latitude"),
    lon: float = Query(..., description="Longitude"),
    top_n: int = Query(default=5, ge=1, le=20),
    max_distance_m: float = Query(default=1500.0, ge=100, le=5000),
    state=Depends(get_app_state),
):
    """Return the nearest transit stops to a given coordinate."""
    results = find_nearest_stops(
        state.graph, lat, lon, top_n=top_n, max_distance_m=max_distance_m
    )
    return [
        StopInfo(
            id=stop_id,
            name=state.graph.nodes[stop_id].get("name", stop_id),
            distance_m=round(dist, 1),
        )
        for stop_id, dist in results
    ]


@router.get("/stops/search", response_model=List[StopInfo])
async def search_stops(
    q: str = Query(..., min_length=2, description="Stop name search query"),
    top_n: int = Query(default=10, ge=1, le=50),
    state=Depends(get_app_state),
):
    """Search for stops by name (case-insensitive substring match)."""
    results = find_stops_by_name(state.graph, q, top_n=top_n)
    return [
        StopInfo(
            id=stop_id,
            name=stop_name,
            distance_m=0.0,  # Not applicable for name search
        )
        for stop_id, stop_name in results
    ]


#  Graph stats (debug / health)
@router.get("/graph/stats", response_model=GraphStatsResponse)
async def graph_stats(state=Depends(get_app_state)):
    """Return basic statistics about the loaded GTFS graph."""
    graph = state.graph
    feed_counts = {}
    for _, attrs in graph.nodes(data=True):
        feed = attrs.get("feed_name", "unknown")
        feed_counts[feed] = feed_counts.get(feed, 0) + 1

    return GraphStatsResponse(
        node_count=graph.number_of_nodes(),
        edge_count=graph.number_of_edges(),
        feed_counts=feed_counts,
    )


# --------------------------------------------------------------------------- #
#  Realtime                                                                    #
# --------------------------------------------------------------------------- #


@router.get("/realtime/vehicles", response_model=RealtimeStatusResponse)
async def realtime_vehicles(
    feed: Optional[str] = Query(
        default=None,
        description="Filter by feed name e.g. 'rapid-bus-kl'. Omit for all feeds.",
    ),
    _state=Depends(get_app_state),
):
    """
    Return current vehicle positions from all available realtime feeds.
    Useful for the frontend map layer showing live vehicle markers.
    """
    from app.services.realtime import realtime_manager
    from app.config import settings

    all_feeds = [name for name, _ in settings.GTFS_REALTIME_FEEDS]
    result = {}

    for feed_name in all_feeds:
        if feed and feed_name != feed:
            continue
        result[feed_name] = realtime_manager.get_positions_for_feed(feed_name)

    total_vehicles = sum(len(v) for v in result.values())

    return RealtimeStatusResponse(
        feeds=result,
        total_vehicles=total_vehicles,
    )
