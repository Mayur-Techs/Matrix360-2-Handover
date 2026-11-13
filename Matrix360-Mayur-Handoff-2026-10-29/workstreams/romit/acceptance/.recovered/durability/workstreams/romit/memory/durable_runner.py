"""Opt-in persistent replay adapter for low-RAM candidate pipelines.

The journal and lead sink MUST use durable, tenant-scoped backing storage.
Render Free's local filesystem is ephemeral and is NOT a suitable production
journal. No production schema changes or networking are performed here.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import AsyncIterable, Awaitable, Callable, Generic, Protocol, TypeVar

from .low_ram_runtime import BoundedPipeline, CgroupMemory

Candidate = TypeVar('Candidate')
Lead = TypeVar('Lead')


class CheckpointStore(Protocol[Candidate]):
    """Adapter contract; key must embed stable tenant, job and candidate IDs."""
    async def reserve(self, key: str, value: Candidate) -> bool:
        """Durably admit a new candidate unless already marked complete."""
        ...

    def pending(self) -> AsyncIterable[tuple[str, Candidate]]:
        """Return an asynchronous iterator of incomplete durable work."""
        ...

    async def acknowledge(self, key: str) -> None:
        """Durably mark done, after downstream upsert has committed."""
        ...


@dataclass(frozen=True)
class RunnerStats:
    persisted: int
    failed_attempts: int
    highest_pending_queue: int


class IncompleteJobError(RuntimeError):
    """At least one candidate remains pending; resume is required."""


class DurableRunner(Generic[Candidate, Lead]):
    """Checkpointed bounded execution with at-least-once replay.

    Sink must support idempotent upsert(key, lead). A crash between sink upsert
    and journal acknowledge is replayed and MUST NOT produce duplicate leads.
    The source itself must also have a restartable cursor for items that were
    never journaled; this adapter cannot guarantee unseen source items.
    """

    def __init__(self, *, journal: CheckpointStore[Candidate],
                 key_of: Callable[[Candidate], str],
                 enrich: Callable[[Candidate], Awaitable[Lead]],
                 upsert: Callable[[str, Lead], Awaitable[None]],
                 workers: int = 2, capacity: int = 4,
                 memory: CgroupMemory | None = None):
        self.journal = journal
        self.key_of = key_of
        self.enrich = enrich
        self.upsert = upsert
        self.workers = workers
        self.capacity = capacity
        self.memory = memory

    async def run(self, source: AsyncIterable[Candidate]) -> RunnerStats:
        # Both recovery and new admissions stream through the same fixed queue.
        async def candidates() -> AsyncIterable[tuple[str, Candidate]]:
            async for key, item in self.journal.pending():
                yield key, item
            async for item in source:
                key = self.key_of(item)
                if not key or not isinstance(key, str):
                    raise ValueError('Stable candidate key required')
                if await self.journal.reserve(key, item):
                    yield key, item

        async def work(entry: tuple[str, Candidate]) -> tuple[str, Lead]:
            key, item = entry
            return key, await self.enrich(item)

        async def save(entry: tuple[str, Lead]) -> None:
            key, result = entry
            await self.upsert(key, result)  # Idempotent durable write first.
            await self.journal.acknowledge(key)  # Only then mark completed.

        pipeline = BoundedPipeline(work, save, workers=self.workers,
                                   capacity=self.capacity, memory=self.memory)
        await pipeline.run(candidates())
        stats = RunnerStats(pipeline.completed, pipeline.failures,
                            pipeline.max_observed_queue)
        if pipeline.failures:
            raise IncompleteJobError(
                f'{pipeline.failures} worker/persistence attempts failed; '
                'checkpointed candidates remain eligible for replay')
        return stats
