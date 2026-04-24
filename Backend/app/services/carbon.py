from typing import Dict, List, Any
from app.config import settings

# Per-route segment calculator
def calculate_segment_co2(agency_type: str, distance_km: float) -> float:
    if agency_type == "rail":
        return settings.CO2_RAIL_PER_KM * distance_km
    elif agency_type == "walk":
        return 0.0
    else:  # bus (default)
        return settings.CO2_BUS_PER_KM * distance_km

# Full route carbon summary
def calculate_route_carbon(legs: List[Dict[str, Any]]) -> Dict[str, Any]:
    total_co2 = 0.0
    total_dist = 0.0
    mode_co2: Dict[str, float] = {"rail": 0.0, "bus": 0.0, "walk": 0.0}
    mode_dist: Dict[str, float] = {"rail": 0.0, "bus": 0.0, "walk": 0.0}

    for leg in legs:
        agency_type = leg.get("agency_type", "bus")
        dist_km = float(leg.get("distance_km", 0.0))
        co2 = calculate_segment_co2(agency_type, dist_km)

        total_co2 += co2
        total_dist += dist_km

        mode_key = agency_type if agency_type in mode_co2 else "bus"
        mode_co2[mode_key] += co2
        mode_dist[mode_key] += dist_km

    # Car baseline: same total distance in a private petrol car
    car_co2 = settings.CO2_CAR_PER_KM * total_dist
    co2_saved = max(0.0, car_co2 - total_co2)
    saved_pct = (co2_saved / car_co2 * 100) if car_co2 > 0 else 0.0
    tree_days = co2_saved / 57.5 if co2_saved > 0 else 0.0

    return {
        "total_transit_co2_grams": round(total_co2, 1),
        "car_baseline_co2_grams": round(car_co2, 1),
        "co2_saved_grams": round(co2_saved, 1),
        "co2_saved_percent": round(saved_pct, 1),
        "equivalent_tree_days": round(tree_days, 2),
        "total_distance_km": round(total_dist, 2),
        "breakdown_by_mode": {
            "rail_co2_grams": round(mode_co2["rail"], 1),
            "bus_co2_grams": round(mode_co2["bus"], 1),
            "walk_co2_grams": 0.0,
            "rail_distance_km": round(mode_dist["rail"], 2),
            "bus_distance_km": round(mode_dist["bus"], 2),
            "walk_distance_km": round(mode_dist["walk"], 2),
        },
        "emission_factors_used": {
            "rail_g_per_km": settings.CO2_RAIL_PER_KM,
            "bus_g_per_km": settings.CO2_BUS_PER_KM,
            "car_g_per_km": settings.CO2_CAR_PER_KM,
        },
    }

# Route comparison (for eco ranking of alternatives)
def rank_routes_by_emissions(routes: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    enriched = []
    for route in routes:
        carbon = calculate_route_carbon(route.get("legs", []))
        enriched.append({**route, "carbon": carbon})

    return sorted(enriched, key=lambda r: r["carbon"]["total_transit_co2_grams"])
