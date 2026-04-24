from typing import List, Tuple
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    GTFS_STATIC_FEEDS: List[Tuple[str, str, str]] = [
        # Rail
        (
            "ktmb",
            "https://api.data.gov.my/gtfs-static/ktmb",
            "rail"
        ),
        (
            "rapid-rail-kl",
            "https://api.data.gov.my/gtfs-static/prasarana?category=rapid-rail-kl",
            "rail",
        ),
        # Rapid Bus (Klang Valley)
        (
            "rapid-bus-kl",
            "https://api.data.gov.my/gtfs-static/prasarana?category=rapid-bus-kl",
            "bus",
        ),
        (
            "rapid-bus-mrtfeeder",
            "https://api.data.gov.my/gtfs-static/prasarana?category=rapid-bus-mrtfeeder",
            "bus",
        ),
        # Rapid Bus (Other states)
        (
            "rapid-bus-penang",
            "https://api.data.gov.my/gtfs-static/prasarana?category=rapid-bus-penang",
            "bus",
        ),
        (
            "rapid-bus-kuantan",
            "https://api.data.gov.my/gtfs-static/prasarana?category=rapid-bus-kuantan",
            "bus",
        ),
        # BAS.MY
        (
            "mybas-kangar",
            "https://api.data.gov.my/gtfs-static/mybas-kangar",
            "bus"
        ),
        (
            "mybas-alor-setar",
            "https://api.data.gov.my/gtfs-static/mybas-alor-setar",
            "bus",
        ),
        (
            "mybas-kota-bharu",
            "https://api.data.gov.my/gtfs-static/mybas-kota-bharu",
            "bus",
        ),
        (
            "mybas-kuala-terengganu",
            "https://api.data.gov.my/gtfs-static/mybas-kuala-terengganu",
            "bus",
        ),
        (
            "mybas-ipoh",
            "https://api.data.gov.my/gtfs-static/mybas-ipoh",
            "bus"
        ),
        (
            "mybas-seremban-a",
            "https://api.data.gov.my/gtfs-static/mybas-seremban-a",
            "bus",
        ),
        (
            "mybas-seremban-b",
            "https://api.data.gov.my/gtfs-static/mybas-seremban-b",
            "bus",
        ),
        (
            "mybas-melaka",
            "https://api.data.gov.my/gtfs-static/mybas-melaka",
            "bus"
        ),
        (
            "mybas-johor",
            "https://api.data.gov.my/gtfs-static/mybas-johor",
            "bus"
        ),
        (
            "mybas-kuching",
            "https://api.data.gov.my/gtfs-static/mybas-kuching",
            "bus"
        ),
    ]

    GTFS_REALTIME_FEEDS: List[Tuple[str, str]] = [
        (
            "ktmb",
            "https://api.data.gov.my/gtfs-realtime/vehicle-position/ktmb"
        ),
        (
            "rapid-bus-kl",
            "https://api.data.gov.my/gtfs-realtime/vehicle-position/prasarana?category=rapid-bus-kl",
        ),
        (
            "rapid-bus-mrtfeeder",
            "https://api.data.gov.my/gtfs-realtime/vehicle-position/prasarana?category=rapid-bus-mrtfeeder",
        ),
        (
            "rapid-bus-kuantan",
            "https://api.data.gov.my/gtfs-realtime/vehicle-position/prasarana?category=rapid-bus-kuantan",
        ),
        (
            "rapid-bus-penang",
            "https://api.data.gov.my/gtfs-realtime/vehicle-position/prasarana?category=rapid-bus-penang",
        ),
    ]

    # Graph edge weight keys
    WEIGHT_TRAVEL_TIME: str = "travel_time_sec"  # seconds
    WEIGHT_FARE: str = "fare_myr"  # Malaysian Ringgit
    WEIGHT_EMISSIONS: str = "co2_grams"  # grams of CO₂

    # Carbon emission factors (grams CO₂ per passenger-km)
    # Sources: MyCC / SPAD / international transit benchmarks
    CO2_RAIL_PER_KM: float = 14.0  # LRT / MRT / KTM (electric)
    CO2_BUS_PER_KM: float = 68.0  # Diesel bus average
    CO2_CAR_PER_KM: float = 192.0  # Private petrol car (baseline for comparison)

    # Default fare estimates (MYR) used when fare data is absent
    # Real fare data from GTFS fare_attributes.txt takes priority.
    DEFAULT_RAIL_FARE_PER_KM: float = 0.15  # MYR per km
    DEFAULT_BUS_FARE_FLAT: float = 1.50  # MYR flat fare per boarding

    # Walking parameters (for interchange / last-mile legs)
    WALK_SPEED_KMH: float = 4.5  # average walking speed
    MAX_TRANSFER_WALK_M: float = 500.0  # max metres to consider a walk transfer
    WALK_CO2_PER_KM: float = 0.0  # walking produces no emissions

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"

settings = Settings()
