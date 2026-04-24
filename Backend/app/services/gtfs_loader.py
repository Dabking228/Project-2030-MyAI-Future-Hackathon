import asyncio
import io
import logging
import zipfile
from math import radians, sin, cos, sqrt, atan2
from typing import Dict, List, Optional, Tuple

import httpx
import networkx as nx
import pandas as pd

from app.config import settings

logger = logging.getLogger(__name__)

# Haversine distance helper
def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6_371_000  # Earth radius in metres
    phi1, phi2 = radians(lat1), radians(lat2)
    dphi = radians(lat2 - lat1)
    dlambda = radians(lon2 - lon1)
    a = sin(dphi / 2) ** 2 + cos(phi1) * cos(phi2) * sin(dlambda / 2) ** 2
    return R * 2 * atan2(sqrt(a), sqrt(1 - a))


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    return haversine_m(lat1, lon1, lat2, lon2) / 1000.0

# Time helper
def gtfs_time_to_seconds(time_str: str) -> int:
    if pd.isna(time_str) or not isinstance(time_str, str):
        return 0
    parts = time_str.strip().split(":")
    if len(parts) != 3:
        return 0
    h, m, s = int(parts[0]), int(parts[1]), int(parts[2])
    return h * 3600 + m * 60 + s

# Main loader class
class GTFSLoader:
    def __init__(self):
        self.graph: nx.MultiDiGraph = nx.MultiDiGraph()
        self.stops: pd.DataFrame = pd.DataFrame()
        self.routes: pd.DataFrame = pd.DataFrame()
        self.trips: pd.DataFrame = pd.DataFrame()
        self.stop_times: pd.DataFrame = pd.DataFrame()
        self.fare_rules: Dict[str, float] = {}

        self._all_stops: List[pd.DataFrame] = []
        self._all_routes: List[pd.DataFrame] = []
        self._all_trips: List[pd.DataFrame] = []
        self._all_stop_times: List[pd.DataFrame] = []
        self._agency_type_map: Dict[str, str] = {}

    # Public entry point
    async def load_all(self) -> None:
        tasks = [
            self._load_feed(name, url, agency_type)
            for name, url, agency_type in settings.GTFS_STATIC_FEEDS
        ]
        await asyncio.gather(*tasks, return_exceptions=True)

        logger.info("Merging DataFrames …")
        self._merge_dataframes()

        logger.info("Building NetworkX graph …")
        self._build_graph()

        logger.info(
            "Graph ready: %d nodes, %d edges",
            self.graph.number_of_nodes(),
            self.graph.number_of_edges(),
        )

    async def _load_feed(self, name: str, url: str, agency_type: str) -> None:
        logger.info("Downloading feed: %s", name)
        try:
            async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
                response = await client.get(url)
                response.raise_for_status()
        except Exception as exc:
            logger.warning("Failed to download %s: %s — skipping", name, exc)
            return

        try:
            parsed = self._parse_zip(response.content, name, agency_type)
        except Exception as exc:
            logger.warning("Failed to parse %s: %s — skipping", name, exc)
            return

        stops, routes, trips, stop_times, fare_df = parsed

        self._all_stops.append(stops)
        self._all_routes.append(routes)
        self._all_trips.append(trips)
        self._all_stop_times.append(stop_times)

        if fare_df is not None and not fare_df.empty:
            for _, row in fare_df.iterrows():
                self.fare_rules[row["route_id"]] = float(
                    row.get("price", settings.DEFAULT_BUS_FARE_FLAT)
                )

        logger.info("Feed %s: %d stops, %d routes", name, len(stops), len(routes))

    def _parse_zip(
        self,
        content: bytes,
        feed_name: str,
        agency_type: str,
    ) -> Tuple[
        pd.DataFrame, pd.DataFrame, pd.DataFrame, pd.DataFrame, Optional[pd.DataFrame]
    ]:
        def read(
            zf: zipfile.ZipFile, filename: str, required: bool = True
        ) -> Optional[pd.DataFrame]:
            try:
                with zf.open(filename) as f:
                    return pd.read_csv(f, dtype=str, low_memory=False)
            except KeyError:
                if required:
                    raise FileNotFoundError(f"{filename} missing in {feed_name}")
                return None

        with zipfile.ZipFile(io.BytesIO(content)) as zf:
            stops_df = read(zf, "stops.txt")
            routes_df = read(zf, "routes.txt")
            trips_df = read(zf, "trips.txt")
            stop_times_df = read(zf, "stop_times.txt")
            fare_attr_df = read(zf, "fare_attributes.txt", required=False)
            fare_rules_df = read(zf, "fare_rules.txt", required=False)

        prefix = feed_name + ":"

        # stops
        stops_df["stop_id"] = prefix + stops_df["stop_id"].astype(str)
        stops_df["feed_name"] = feed_name
        stops_df["agency_type"] = agency_type
        stops_df["stop_lat"] = pd.to_numeric(stops_df["stop_lat"], errors="coerce")
        stops_df["stop_lon"] = pd.to_numeric(stops_df["stop_lon"], errors="coerce")
        stops_df = stops_df.dropna(subset=["stop_lat", "stop_lon"])

        # routes
        routes_df["route_id"] = prefix + routes_df["route_id"].astype(str)
        routes_df["agency_type"] = agency_type
        routes_df["feed_name"] = feed_name

        # Track agency type per route for edge weight calculation
        for rid in routes_df["route_id"]:
            self._agency_type_map[rid] = agency_type

        # trips
        trips_df["trip_id"] = prefix + trips_df["trip_id"].astype(str)
        trips_df["route_id"] = prefix + trips_df["route_id"].astype(str)

        # stop_times
        stop_times_df["trip_id"] = prefix + stop_times_df["trip_id"].astype(str)
        stop_times_df["stop_id"] = prefix + stop_times_df["stop_id"].astype(str)
        stop_times_df["stop_sequence"] = pd.to_numeric(
            stop_times_df["stop_sequence"], errors="coerce"
        )
        stop_times_df = stop_times_df.sort_values(["trip_id", "stop_sequence"])

        # fare attributes + rules (optional)
        fare_combined = None
        if fare_attr_df is not None and fare_rules_df is not None:
            fare_attr_df["fare_id"] = prefix + fare_attr_df["fare_id"].astype(str)
            fare_rules_df["fare_id"] = prefix + fare_rules_df["fare_id"].astype(str)
            if "route_id" in fare_rules_df.columns:
                fare_rules_df["route_id"] = prefix + fare_rules_df["route_id"].astype(
                    str
                )
            fare_combined = fare_rules_df.merge(
                fare_attr_df[["fare_id", "price"]], on="fare_id", how="left"
            )

        return stops_df, routes_df, trips_df, stop_times_df, fare_combined

    def _merge_dataframes(self) -> None:
        self.stops = pd.concat(self._all_stops, ignore_index=True)
        self.routes = pd.concat(self._all_routes, ignore_index=True)
        self.trips = pd.concat(self._all_trips, ignore_index=True)
        self.stop_times = pd.concat(self._all_stop_times, ignore_index=True)

        self._stop_lookup: Dict[str, dict] = {
            row["stop_id"]: {
                "lat": row["stop_lat"],
                "lon": row["stop_lon"],
                "name": row.get("stop_name", row["stop_id"]),
                "agency_type": row.get("agency_type", "bus"),
                "feed_name": row.get("feed_name", ""),
            }
            for _, row in self.stops.iterrows()
        }

        trips_routes = self.trips.merge(
            self.routes[["route_id", "agency_type"]],
            on="route_id",
            how="left",
        )
        self._stop_times_enriched = self.stop_times.merge(
            trips_routes[["trip_id", "route_id", "agency_type"]],
            on="trip_id",
            how="left",
        )

    def _build_graph(self) -> None:
        self._add_stop_nodes()
        self._add_transit_edges()
        self._add_walk_transfer_edges()

    def _add_stop_nodes(self) -> None:
        """One node per unique stop_id."""
        for stop_id, attrs in self._stop_lookup.items():
            self.graph.add_node(
                stop_id,
                lat=attrs["lat"],
                lon=attrs["lon"],
                name=attrs["name"],
                agency_type=attrs["agency_type"],
                feed_name=attrs["feed_name"],
            )
        logger.info("Added %d stop nodes", self.graph.number_of_nodes())

    def _add_transit_edges(self) -> None:
        df = self._stop_times_enriched.copy()

        df["dep_sec"] = df["departure_time"].apply(gtfs_time_to_seconds)
        df["arr_sec"] = df["arrival_time"].apply(gtfs_time_to_seconds)

        edge_count = 0

        for trip_id, group in df.groupby("trip_id"):
            group = group.sort_values("stop_sequence").reset_index(drop=True)

            for i in range(len(group) - 1):
                curr = group.iloc[i]
                nxt = group.iloc[i + 1]

                from_stop = curr["stop_id"]
                to_stop = nxt["stop_id"]

                if (
                    from_stop not in self._stop_lookup
                    or to_stop not in self._stop_lookup
                ):
                    continue

                fs = self._stop_lookup[from_stop]
                ts = self._stop_lookup[to_stop]

                dist_km = haversine_km(fs["lat"], fs["lon"], ts["lat"], ts["lon"])
                travel_time_sec = max(
                    nxt["arr_sec"] - curr["dep_sec"],
                    60,  # floor: at least 1 minute between stops
                )

                route_id = str(curr.get("route_id", ""))
                agency_type = str(curr.get("agency_type", "bus"))

                fare_myr = self._estimate_fare(route_id, agency_type, dist_km)
                co2_grams = self._estimate_co2(agency_type, dist_km)

                self.graph.add_edge(
                    from_stop,
                    to_stop,
                    key=trip_id,
                    trip_id=trip_id,
                    route_id=route_id,
                    agency_type=agency_type,
                    departure_time=curr["departure_time"],
                    arrival_time=nxt["arrival_time"],
                    travel_time_sec=travel_time_sec,
                    fare_myr=fare_myr,
                    co2_grams=co2_grams,
                    distance_km=dist_km,
                    edge_type="transit",
                )
                edge_count += 1

        logger.info("Added %d transit edges", edge_count)

    def _add_walk_transfer_edges(self) -> None:
        stops_list = list(self._stop_lookup.items())
        walk_count = 0
        max_m = settings.MAX_TRANSFER_WALK_M

        for i in range(len(stops_list)):
            sid_a, a = stops_list[i]
            for j in range(i + 1, len(stops_list)):
                sid_b, b = stops_list[j]

                # Calculate distance between stops
                dist_m = haversine_m(a["lat"], a["lon"], b["lat"], b["lon"])
                if dist_m > max_m:
                    continue

                dist_km = dist_m / 1000.0
                walk_sec = int((dist_km / settings.WALK_SPEED_KMH) * 3600)

                edge_attrs = dict(
                    trip_id="walk",
                    route_id="walk",
                    agency_type="walk",
                    travel_time_sec=walk_sec,
                    fare_myr=0.0,
                    co2_grams=0.0,
                    distance_km=dist_km,
                    edge_type="walk",
                )
                self.graph.add_edge(sid_a, sid_b, key="walk", **edge_attrs)
                self.graph.add_edge(sid_b, sid_a, key="walk", **edge_attrs)
                walk_count += 2

        logger.info("Added %d walk-transfer edges", walk_count)

    def _estimate_fare(self, route_id: str, agency_type: str, dist_km: float) -> float:
        if route_id in self.fare_rules:
            return self.fare_rules[route_id]
        if agency_type == "rail":
            return round(settings.DEFAULT_RAIL_FARE_PER_KM * dist_km, 2)
        return settings.DEFAULT_BUS_FARE_FLAT

    def _estimate_co2(self, agency_type: str, dist_km: float) -> float:
        if agency_type == "rail":
            return settings.CO2_RAIL_PER_KM * dist_km
        if agency_type == "walk":
            return 0.0
        return settings.CO2_BUS_PER_KM * dist_km
