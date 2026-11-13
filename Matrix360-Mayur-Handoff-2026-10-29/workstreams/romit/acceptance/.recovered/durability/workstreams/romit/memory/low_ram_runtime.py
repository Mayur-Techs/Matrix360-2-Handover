"""Stand-alone, opt-in RAM telemetry and bounded async execution utilities.

Does NOT create a hard memory cap. Nothing in this module is wired into a
live service; an owner must explicitly integrate it after contract review.
"""
from __future__ import annotations

import asyncio
import csv
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, AsyncIterable, Awaitable, Callable, Generic, TypeVar

T = TypeVar("T")
R = TypeVar("R")
_MIB = 1024 * 1024
_STOP = object()


class MemoryBudgetExceeded(RuntimeError):
    """Application-level safety stop; not an enforced kernel limit."""


@dataclass(frozen=True)
class MemorySample:
    timestamp: str
    used_mib: float
    peak_mib: float | None
    limit_mib: float | None
    state: str
    source: str


class CgroupMemory:
    """Read whole-container memory, including Chromium subprocesses.

    Uses cgroup v2 first, then v1. It intentionally refuses to substitute
    process RSS for missing whole-container metrics.
    """

    def __init__(self, root: str | Path = "/sys/fs/cgroup") -> None:
        self.root = Path(root)

    def _read_number(self, name: str) -> int | None:
        try:
            value = (self.root / name).read_text(encoding="ascii").strip()
            return None if value == "max" else int(value)
        except (OSError, ValueError):
            return None

    def snapshot(self, warning_mib: int = 300,
                 pause_mib: int = 330, critical_mib: int = 370) -> MemorySample:
        if not 0 < warning_mib < pause_mib < critical_mib:
            raise ValueError("Require 0 < warning < pause < critical")
        used = self._read_number("memory.current")
        if used is not None:
            peak = self._read_number("memory.peak")
            limit = self._read_number("memory.max")
            source = "cgroup-v2"
        else:
            used = self._read_number("memory/memory.usage_in_bytes")
            if used is None:
                raise RuntimeError("Container memory counters unavailable; no whole-workload sample")
            peak = self._read_number("memory/memory.max_usage_in_bytes")
            limit = self._read_number("memory/memory.limit_in_bytes")
            # Some cgroup-v1 kernels return a huge sentinel for unlimited.
            if limit is not None and limit >= (1 << 60):
                limit = None
            source = "cgroup-v1"
        state = ("critical" if used >= critical_mib * _MIB else
                 "pressure" if used >= pause_mib * _MIB else
                 "warning" if used >= warning_mib * _MIB else "normal")
        return MemorySample(
            datetime.now(timezone.utc).isoformat(), round(used / _MIB, 2),
            round(peak / _MIB, 2) if peak is not None else None,
            round(limit / _MIB, 2) if limit is not None else None,
            state, source,
        )


def write_sample_csv(path: str | Path, sample: MemorySample, *,
                     active_workers: int, queue_depth: int,
                     completed: int, failures: int) -> None:
    """Append a single bounded row of numeric telemetry; no lead data."""
    path = Path(path)
    fields = ("timestamp", "used_mib", "peak_mib", "limit_mib", "state",
              "source", "active_workers", "queue_depth", "completed", "failures")
    existed = path.exists() and path.stat().st_size > 0
    with path.open("a", newline="", encoding="utf-8") as output:
        writer = csv.DictWriter(output, fieldnames=fields)
        if not existed:
            writer.writeheader()
        writer.writerow({**sample.__dict__, "active_workers": active_workers,
                         "queue_depth": queue_depth, "completed": completed,
                         "failures": failures})


class BoundedPipeline(Generic[T, R]):
    """Backpressure-enabled producer/consumer executor.

    Result objects are persisted and discarded immediately. No completed
    collection is held in memory. Failure summaries are bounded at 10.
    """

    def __init__(self, handle: Callable[[T], Awaitable[R]],
                 persist: Callable[[R], Awaitable[None]], *,
                 workers: int = 2, capacity: int = 4,
                 memory: CgroupMemory | None = None,
                 pressure_retries: int = 10) -> None:
        if not 1 <= workers <= 2 or not 1 <= capacity <= 4:
            raise ValueError("Low-RAM mode requires 1-2 workers and queue capacity 1-4")
        if pressure_retries < 1:
            raise ValueError("pressure_retries must be positive")
        self.handle, self.persist = handle, persist
        self.workers, self.capacity = workers, capacity
        self.memory, self.pressure_retries = memory, pressure_retries
        self.completed = 0
        self.failures = 0
        self.error_summaries: list[str] = []
        self.max_observed_queue = 0
        self.active_workers = 0

    async def run(self, source: AsyncIterable[T], *,
                  stop: asyncio.Event | None = None) -> None:
        queue: asyncio.Queue[Any] = asyncio.Queue(maxsize=self.capacity)
        stopping = stop or asyncio.Event()
        self.completed = self.failures = self.max_observed_queue = 0
        self.error_summaries = []

        async def consumer() -> None:
            while True:
                item = await queue.get()
                if item is _STOP:
                    queue.task_done()
                    return
                self.active_workers += 1
                try:
                    result = await self.handle(item)
                    await self.persist(result)
                    self.completed += 1
                except asyncio.CancelledError:
                    raise
                except Exception as exc:
                    self.failures += 1
                    if len(self.error_summaries) < 10:
                        self.error_summaries.append(type(exc).__name__)
                finally:
                    self.active_workers -= 1
                    queue.task_done()

        tasks = [asyncio.create_task(consumer()) for _ in range(self.workers)]
        try:
            async for item in source:
                if stopping.is_set():
                    break
                if self.memory is not None:
                    for attempt in range(self.pressure_retries):
                        sample = self.memory.snapshot()
                        if sample.state == "critical":
                            raise MemoryBudgetExceeded("Critical whole-container RAM threshold")
                        if sample.state != "pressure":
                            break
                        await asyncio.sleep(0.2)
                    else:
                        raise MemoryBudgetExceeded("RAM pressure persisted; producer halted")
                await queue.put(item)  # Blocks the producer at capacity.
                self.max_observed_queue = max(self.max_observed_queue, queue.qsize())
            await queue.join()
        finally:
            # On exceptions/cancellation, abandon unfinished candidates safely.
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            self.active_workers = 0
