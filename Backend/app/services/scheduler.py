import asyncio
import logging
from typing import Optional

import pandas as pd

logger = logging.getLogger(__name__)

_scheduler_task: Optional[asyncio.Task] = None


async def _refresh_loop(stop_times_df: pd.DataFrame, interval_sec: int = 28) -> None:
    from app.services.realtime import realtime_manager

    while True:
        try:
            await realtime_manager.refresh_all(stop_times_df)
        except Exception as exc:
            logger.warning("Realtime refresh loop error: %s", exc)
        await asyncio.sleep(interval_sec)


def start_realtime_scheduler(stop_times_df: pd.DataFrame) -> None:
    global _scheduler_task
    _scheduler_task = asyncio.create_task(_refresh_loop(stop_times_df))
    logger.info("Realtime scheduler started (interval=28s)")


def stop_realtime_scheduler() -> None:
    global _scheduler_task
    if _scheduler_task and not _scheduler_task.done():
        _scheduler_task.cancel()
        logger.info("Realtime scheduler stopped")
