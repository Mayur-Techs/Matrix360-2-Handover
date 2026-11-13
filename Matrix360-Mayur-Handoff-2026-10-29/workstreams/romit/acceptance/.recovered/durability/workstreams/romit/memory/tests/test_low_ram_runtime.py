import asyncio
import csv
import tempfile
import unittest
from pathlib import Path

from workstreams.romit.memory.low_ram_runtime import (
    BoundedPipeline, CgroupMemory, MemoryBudgetExceeded, write_sample_csv,
)


class CgroupTests(unittest.TestCase):
    def test_v2_thresholds_and_limit(self):
        with tempfile.TemporaryDirectory() as temp:
            p = Path(temp)
            (p / "memory.current").write_text(str(335 * 1024 * 1024))
            (p / "memory.peak").write_text(str(350 * 1024 * 1024))
            (p / "memory.max").write_text(str(512 * 1024 * 1024))
            s = CgroupMemory(p).snapshot()
            self.assertEqual((s.used_mib, s.peak_mib, s.limit_mib, s.state),
                             (335.0, 350.0, 512.0, "pressure"))
            write_sample_csv(p / "samples.csv", s, active_workers=2,
                             queue_depth=4, completed=5, failures=1)
            with (p / "samples.csv").open(encoding="utf-8") as f:
                rows = list(csv.DictReader(f))
            self.assertEqual(rows[0]["queue_depth"], "4")

    def test_missing_cgroup_refuses_process_rss(self):
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaises(RuntimeError):
                CgroupMemory(temp).snapshot()

    def test_v1_cgroup_fallback(self):
        with tempfile.TemporaryDirectory() as temp:
            p = Path(temp) / "memory"
            p.mkdir()
            (p / "memory.usage_in_bytes").write_text(str(305 * 1024 * 1024))
            (p / "memory.limit_in_bytes").write_text(str(512 * 1024 * 1024))
            s = CgroupMemory(p.parent).snapshot()
            self.assertEqual((s.state, s.source), ("warning", "cgroup-v1"))


class PipelineTests(unittest.IsolatedAsyncioTestCase):
    async def test_bounded_concurrency_persistence(self):
        running = peak = 0
        saved = []

        async def source():
            for n in range(30):
                yield n

        async def work(n):
            nonlocal running, peak
            running += 1
            peak = max(peak, running)
            await asyncio.sleep(0.002)
            running -= 1
            return n * 2

        async def persist(n):
            saved.append(n)

        engine = BoundedPipeline(work, persist, workers=2, capacity=4)
        await engine.run(source())
        self.assertEqual(engine.completed, 30)
        self.assertEqual(len(saved), 30)
        self.assertLessEqual(peak, 2)
        self.assertLessEqual(engine.max_observed_queue, 4)

    async def test_failure_recorded_and_later_jobs_continue(self):
        async def source():
            for n in range(3):
                yield n
        async def work(n):
            if n == 1:
                raise ValueError("unexpected")
            return n
        saved = []
        async def persist(n):
            saved.append(n)
        engine = BoundedPipeline(work, persist)
        await engine.run(source())
        self.assertEqual((engine.completed, engine.failures), (2, 1))
        self.assertEqual(sorted(saved), [0, 2])
        self.assertEqual(engine.error_summaries, ["ValueError"])

    async def test_critical_budget_aborts_admission(self):
        async def source():
            yield 1
        async def noop(n):
            return n
        class Critical:
            def snapshot(self):
                return type("Sample", (), {"state": "critical"})()
        engine = BoundedPipeline(noop, noop, memory=Critical())
        with self.assertRaises(MemoryBudgetExceeded):
            await engine.run(source())
        self.assertEqual(engine.active_workers, 0)

    async def test_pressure_backoff_is_finite(self):
        async def source():
            yield 1
        async def noop(n):
            return n
        class Pressure:
            def snapshot(self):
                return type("Sample", (), {"state": "pressure"})()
        engine = BoundedPipeline(noop, noop, memory=Pressure(), pressure_retries=1)
        with self.assertRaises(MemoryBudgetExceeded):
            await engine.run(source())
        self.assertEqual(engine.completed, 0)

    async def test_stop_event_blocks_new_admissions(self):
        flag = asyncio.Event()
        flag.set()
        async def source():
            for n in range(5):
                yield n
        async def work(n):
            return n
        saved = []
        async def persist(n):
            saved.append(n)
        engine = BoundedPipeline(work, persist)
        await engine.run(source(), stop=flag)
        self.assertEqual(saved, [])


if __name__ == "__main__":
    unittest.main()
