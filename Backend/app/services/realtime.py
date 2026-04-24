import asyncio
import logging
import time
from math import radians, sin, cos, sqrt, atan2
from typing import Dict, List, Optional, Tuple

import httpx
import networkx as nx
from google.transit import gtfs_realtime_pb2

from app.config import settings

logger = logging.getLogger(__name__)

# Constants
CACHE_TTL_SEC = 25
MAX_DELAY_SEC = 30 * 60

SKIP_FEEDS = {"rapid-rail-kl"}

SUFFIX_MATCH_FEEDS = {"rapid-bus-penang", "rapid-bus-kuantan"}

class VehiclePosition:
    __slots__ = (
        "vehicle_id",
        "trip_id",
        "route_id",
        "feed_name",
        "lat",
        "lon",
        "timestamp",
        "current_stop_sequence",
        "current_status",
    )

    def __init__(
        self,
        vehicle_id: str,
        trip_id: str,
        route_id: str,
        feed_name: str,
        lat: float,
        lon: float,
        timestamp: int,
        current_stop_sequence: int,
        current_status: str,
    ):
        self.vehicle_id = vehicle_id
        self.trip_id = trip_id
        self.route_id = route_id
        self.feed_name = feed_name
        self.lat = lat
        self.lon = lon
        self.timestamp = timestamp
        self.current_stop_sequence = current_stop_sequence
        self.current_status = current_status

class RealtimeManager:
    def __init__(self):
        self._positions: Dict[str, List[VehiclePosition]] = {}
        self._trip_delays: Dict[str, int] = {}
        self._last_fetch: Dict[str, float] = {}
        self._trip_suffix_index: Dict[str, str] = {}

    async def refresh_all(self, stop_times_df) -> None:
        self._build_suffix_index(stop_times_df)
        tasks = [
            self._fetch_feed(name, url)
            for name, url in settings.GTFS_REALTIME_FEEDS
            if name not in SKIP_FEEDS
        ]
        await asyncio.gather(*tasks, return_exceptions=True)
        self._infer_delays(stop_times_df)
        logger.info(
            "Realtime refresh complete: %d feeds, %d trip delays inferred",
            len(self._positions),
            len(self._trip_delays),
        )

    def get_trip_delay(self, trip_id: str) -> int:
        return self._trip_delays.get(trip_id, 0)

    def apply_realtime_overlay(self, graph: nx.MultiDiGraph) -> nx.MultiDiGraph:
        if not self._trip_delays:
            return graph

        overlaid = graph.copy()

        adjusted = 0
        for u, v, key, data in overlaid.edges(data=True, keys=True):
            trip_id = data.get("trip_id", "")
            delay = self._trip_delays.get(trip_id, 0)
            if delay > 0:
                data["travel_time_sec"] = data.get("travel_time_sec", 0) + delay
                adjusted += 1

        logger.debug("Realtime overlay: adjusted %d edges", adjusted)
        return overlaid

    def get_positions_for_feed(self, feed_name: str) -> List[Dict]:
        positions = self._positions.get(feed_name, [])
        return [
            {
                "vehicle_id": p.vehicle_id,
                "trip_id": p.trip_id,
                "route_id": p.route_id,
                "lat": p.lat,
                "lon": p.lon,
                "timestamp": p.timestamp,
                "current_stop_sequence": p.current_stop_sequence,
                "current_status": p.current_status,
            }
            for p in positions
        ]

    async def _fetch_feed(self, feed_name: str, url: str) -> None:
        last = self._last_fetch.get(feed_name, 0)
        if time.time() - last < CACHE_TTL_SEC:
            logger.debug("Realtime cache hit: %s", feed_name)
            return

        logger.info("Fetching realtime feed: %s", feed_name)
        try:
            async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
                response = await client.get(url)
                response.raise_for_status()
        except Exception as exc:
            logger.warning("Realtime fetch failed for %s: %s", feed_name, exc)
            return

        try:
            positions = self._parse_protobuf(response.content, feed_name)
            self._positions[feed_name] = positions
            self._last_fetch[feed_name] = time.time()
            logger.info("Realtime %s: %d vehicles", feed_name, len(positions))
        except Exception as exc:
            logger.warning("Realtime parse failed for %s: %s", feed_name, exc)

    def _parse_protobuf(self, content: bytes, feed_name: str) -> List[VehiclePosition]:
        feed = gtfs_realtime_pb2.FeedMessage()
        feed.ParseFromString(content)

        prefix = feed_name + ":"
        use_suffix_match = feed_name in SUFFIX_MATCH_FEEDS
        positions = []

        for entity in feed.entity:
            if not entity.HasField("vehicle"):
                continue

            vp = entity.vehicle

            raw_trip_id = vp.trip.trip_id if vp.trip.trip_id else ""
            raw_route_id = vp.trip.route_id if vp.trip.route_id else ""

            if use_suffix_match and raw_trip_id:
                trip_id = self._resolve_suffix_trip_id(raw_trip_id, feed_name)
            else:
                trip_id = prefix + raw_trip_id if raw_trip_id else ""

            route_id = prefix + raw_route_id if raw_route_id else ""

            lat = vp.position.latitude if vp.position.latitude else 0.0
            lon = vp.position.longitude if vp.position.longitude else 0.0

            if not _is_valid_malaysia_coords(lat, lon):
                continue

            positions.append(
                VehiclePosition(
                    vehicle_id=entity.id,
                    trip_id=trip_id,
                    route_id=route_id,
                    feed_name=feed_name,
                    lat=lat,
                    lon=lon,
                    timestamp=vp.timestamp if vp.timestamp else 0,
                    current_stop_sequence=vp.current_stop_sequence,
                    current_status=_status_str(vp.current_status),
                )
            )

        return positions

    # Trip ID suffix resolution (for rapid-bus-penang)
    def _build_suffix_index(self, stop_times_df) -> None:
        if stop_times_df is None or stop_times_df.empty:
            return

        for trip_id in stop_times_df["trip_id"].unique():
            # The realtime ID is the portion AFTER the service prefix
            # Index by everything after the first underscore segment
            parts = str(trip_id).split(":")
            if len(parts) == 2:
                suffix = parts[1].split("_", 1)[-1] # strip service prefix
                self._trip_suffix_index[suffix] = trip_id

        logger.info("Built trip suffix index: %d entries", len(self._trip_suffix_index))

    def _resolve_suffix_trip_id(self, raw_rt_trip_id: str, feed_name: str) -> str:
        if raw_rt_trip_id in self._trip_suffix_index:
            return self._trip_suffix_index[raw_rt_trip_id]
        return feed_name + ":" + raw_rt_trip_id

    def _infer_delays(self, stop_times_df) -> None:
        if stop_times_df is None or stop_times_df.empty:
            self._trip_delays = {}
            return

        new_delays: Dict[str, int] = {}
        now_sec = _wall_clock_seconds()

        active_trip_ids = set()
        for positions in self._positions.values():
            for p in positions:
                if p.trip_id:
                    active_trip_ids.add(p.trip_id)

        if not active_trip_ids:
            self._trip_delays = {}
            return

        active_st = stop_times_df[stop_times_df["trip_id"].isin(active_trip_ids)].copy()

        from app.services.gtfs_loader import gtfs_time_to_seconds

        active_st["dep_sec"] = active_st["departure_time"].apply(gtfs_time_to_seconds)

        st_by_trip = {
            tid: grp.sort_values("stop_sequence").reset_index(drop=True)
            for tid, grp in active_st.groupby("trip_id")
        }

        for positions in self._positions.values():
            for vp in positions:
                if not vp.trip_id or vp.trip_id not in st_by_trip:
                    continue

                trip_stops = st_by_trip[vp.trip_id]
                seq = vp.current_stop_sequence

                row = trip_stops[trip_stops["stop_sequence"] == str(seq)]
                if row.empty:
                    try:
                        row = trip_stops[trip_stops["stop_sequence"].astype(int) == seq]
                    except (ValueError, TypeError):
                        continue

                if row.empty:
                    continue

                scheduled_dep = int(row.iloc[0]["dep_sec"])
                delay_sec = now_sec - scheduled_dep

                if 0 < delay_sec <= MAX_DELAY_SEC:
                    new_delays[vp.trip_id] = delay_sec

        self._trip_delays = new_delays
        logger.info("Delay inference: %d trips with positive delay", len(new_delays))

# Module-level singleton
realtime_manager = RealtimeManager()

def _is_valid_malaysia_coords(lat: float, lon: float) -> bool:
    return (0.8 <= lat <= 7.5) and (99.5 <= lon <= 119.5)


def _status_str(status_code: int) -> str:
    mapping = {0: "INCOMING_AT", 1: "STOPPED_AT", 2: "IN_TRANSIT_TO"}
    return mapping.get(status_code, "UNKNOWN")


def _wall_clock_seconds() -> int:
    import datetime

    now = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8)))
    return now.hour * 3600 + now.minute * 60 + now.second
