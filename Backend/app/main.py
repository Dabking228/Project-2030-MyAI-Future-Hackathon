import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.services.gtfs_loader import GTFSLoader
from app.services.realtime import realtime_manager
from app.services.scheduler import start_realtime_scheduler, stop_realtime_scheduler
from app.state import AppState

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("=== Startup: loading GTFS Static data ===")
    loader = GTFSLoader()
    await loader.load_all()

    app.state.gtfs = AppState(
        graph=loader.graph,
        stops=loader.stops,
        routes=loader.routes,
        trips=loader.trips,
        stop_times=loader.stop_times,
        fare_rules=loader.fare_rules,
    )
    logger.info(
        "GTFS graph ready: %d nodes, %d edges",
        loader.graph.number_of_nodes(),
        loader.graph.number_of_edges(),
    )

    logger.info("=== Startup: initial realtime fetch ===")
    try:
        await realtime_manager.refresh_all(loader.stop_times)
    except Exception as exc:
        logger.warning("Initial realtime fetch failed (non-fatal): %s", exc)

    start_realtime_scheduler(loader.stop_times)

    logger.info("=== App ready ===")
    yield

    # --- Shutdown ---
    stop_realtime_scheduler()
    logger.info("=== Shutdown complete ===")


app = FastAPI(
    title="SYBAR_AI Optimizer API",
    description="Public transport route optimization API for Malaysia",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Tighten this in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api/v1")


@app.get("/health")
async def health_check():
    return {"status": "ok"}
