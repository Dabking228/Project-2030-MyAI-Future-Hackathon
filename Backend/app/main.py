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


import asyncio

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize empty state immediately so app doesn't crash
    app.state.gtfs = AppState()
    
    async def load_data_background():
        logger.info("=== Background: loading GTFS Static data ===")
        loader = GTFSLoader()
        try:
            await loader.load_all()

            app.state.gtfs = AppState(
                is_ready=True,
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

            logger.info("=== Background: initial realtime fetch ===")
            try:
                await realtime_manager.refresh_all(loader.stop_times)
            except Exception as exc:
                logger.warning("Initial realtime fetch failed (non-fatal): %s", exc)

            start_realtime_scheduler(loader.stop_times)
            logger.info("=== Background loading complete: App ready ===")
        except Exception as e:
            logger.error("FATAL: Background loading failed: %s", e)

    # Spawn the background task
    asyncio.create_task(load_data_background())
    
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
    is_ready = getattr(app.state, "gtfs", None) and app.state.gtfs.is_ready
    return {
        "status": "ok" if is_ready else "loading",
        "ready": is_ready
    }
