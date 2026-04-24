from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, Field


# Shared sub-models
class Coordinates(BaseModel):
    lat: float = Field(..., description="Latitude")
    lon: float = Field(..., description="Longitude")


class RouteLeg(BaseModel):
    from_stop_id: str
    from_stop_name: str
    to_stop_id: str
    to_stop_name: str
    trip_id: str
    route_id: str
    agency_type: str  # "rail" | "bus" | "walk"
    edge_type: str  # "transit" | "walk"
    departure_time: Optional[str] = None
    arrival_time: Optional[str] = None
    travel_time_sec: int
    fare_myr: float
    co2_grams: float
    distance_km: float


class CarbonSummary(BaseModel):
    total_transit_co2_grams: float
    car_baseline_co2_grams: float
    co2_saved_grams: float
    co2_saved_percent: float
    equivalent_tree_days: float
    total_distance_km: float
    breakdown_by_mode: Dict[str, float]
    emission_factors_used: Dict[str, float]


class RouteResult(BaseModel):
    legs: List[RouteLeg]
    total_time_sec: int
    total_fare_myr: float
    total_co2_grams: float
    total_distance_km: float
    car_co2_grams: float
    co2_saved_grams: float
    instructions: List[str]
    objective: str
    carbon: Optional[CarbonSummary] = None


class StopInfo(BaseModel):
    id: str
    name: str
    distance_m: float

# Route optimization request / response
class RouteRequest(BaseModel):
    origin: Coordinates
    destination: Coordinates
    optimize_for: Literal["time", "cost", "eco"] = Field(
        default="time", description="Optimization objective: 'time', 'cost', or 'eco'"
    )
    return_alternatives: bool = Field(
        default=True, description="Whether to return alternative routes"
    )


class RouteResponse(BaseModel):
    recommended: Optional[RouteResult]
    alternatives: List[RouteResult] = []
    reasoning: str
    origin_stop: Optional[StopInfo] = None
    destination_stop: Optional[StopInfo] = None
    error: Optional[str] = None


# TSP (multi-destination) request / response
class TSPRequest(BaseModel):
    origin: Coordinates
    destinations: List[Coordinates] = Field(
        ...,
        min_length=2,
        max_length=10,
        description="2–10 destinations to visit in the most optimal order",
    )
    optimize_for: Literal["time", "cost", "eco"] = Field(default="time")
    return_to_origin: bool = Field(
        default=False,
        description="Whether the route should return to the starting point",
    )


class TSPResponse(BaseModel):
    ordered_destinations: List[Coordinates]
    legs_between_stops: List[RouteResult]
    total_time_sec: int
    total_fare_myr: float
    total_co2_grams: float
    reasoning: str
    error: Optional[str] = None


#  Graph health / debug
class GraphStatsResponse(BaseModel):
    node_count: int
    edge_count: int
    feed_counts: Dict[str, int]

# Realtime
class VehiclePositionInfo(BaseModel):
    vehicle_id: str
    trip_id: str
    route_id: str
    lat: float
    lon: float
    timestamp: int
    current_stop_sequence: int
    current_status: str  # "INCOMING_AT" | "STOPPED_AT" | "IN_TRANSIT_TO"


class RealtimeStatusResponse(BaseModel):
    feeds: Dict[str, List[VehiclePositionInfo]]
    total_vehicles: int
