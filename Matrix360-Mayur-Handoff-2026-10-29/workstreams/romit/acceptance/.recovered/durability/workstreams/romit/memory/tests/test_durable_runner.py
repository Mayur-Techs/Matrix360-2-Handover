import asyncio
import json
import os
import sqlite3
import tempfile
import unittest

from workstreams.romit.memory.durable_runner import DurableRunner, IncompleteJobError


class SqliteFixture:
    """Fixture only. Render Free ephemeral disk must not host the actual store."""
    def __init__(self, path, tenant='tenant-a', job='job-1'):
        self.path, self.tenant, self.job = path, tenant, job
        self.conn = sqlite3.connect(path)
        self.conn.execute('PRAGMA journal_mode=WAL')
        self.conn.execute('CREATE TABLE IF NOT EXISTS candidate (tenant TEXT, job TEXT, key TEXT, payload TEXT, done INTEGER DEFAULT 0, PRIMARY KEY(tenant, job, key))')
        self.conn.execute('CREATE TABLE IF NOT EXISTS leads (tenant TEXT, job TEXT, key TEXT, result TEXT, PRIMARY KEY(tenant, job, key))')
        self.conn.commit()

    async def reserve(self, key, value):
        row = self.conn.execute('SELECT done FROM candidate WHERE tenant=? AND job=? AND key=?', (self.tenant,self.job,key)).fetchone()
        if row:
            return False
        self.conn.execute('INSERT INTO candidate(tenant,job,key,payload) VALUES (?,?,?,?)', (self.tenant,self.job,key,json.dumps(value)))
        self.conn.commit()
        return True

    async def pending(self):
        cursor = self.conn.execute('SELECT key,payload FROM candidate WHERE tenant=? AND job=? AND done=0 ORDER BY key',(self.tenant,self.job))
        while True:
            rows = cursor.fetchmany(3)
            if not rows: break
            for key,payload in rows: yield key,json.loads(payload)

    async def acknowledge(self, key):
        self.conn.execute('UPDATE candidate SET done=1 WHERE tenant=? AND job=? AND key=?', (self.tenant,self.job,key))
        self.conn.commit()

    async def upsert(self, key, item):
        self.conn.execute('INSERT OR REPLACE INTO leads(tenant,job,key,result) VALUES (?,?,?,?)',(self.tenant,self.job,key,json.dumps(item)))
        self.conn.commit()

    def counts(self):
        cand = self.conn.execute('SELECT COUNT(*),COALESCE(SUM(done),0) FROM candidate WHERE tenant=? AND job=?',(self.tenant,self.job)).fetchone()
        leads = self.conn.execute('SELECT COUNT(*) FROM leads WHERE tenant=? AND job=?',(self.tenant,self.job)).fetchone()[0]
        return (*cand,leads)

    def close(self):
        self.conn.close()


async def empty_source():
    if False: yield {}


class DurableTests(unittest.IsolatedAsyncioTestCase):
    async def test_checkpoint_completion_and_repeat_no_duplicates(self):
        with tempfile.TemporaryDirectory() as temp:
            journal = SqliteFixture(os.path.join(temp,'j.db'))
            async def source():
                for n in range(120): yield {'key':str(n),'v':n}
            async def enrich(item):
                await asyncio.sleep(0)
                return {'lead':item['v']}
            engine = DurableRunner(journal=journal,key_of=lambda x:x['key'],enrich=enrich,upsert=journal.upsert)
            stats = await engine.run(source())
            self.assertEqual(stats.persisted,120)
            self.assertLessEqual(stats.highest_pending_queue,4)
            self.assertEqual(journal.counts(),(120,120,120))
            await engine.run(source())
            self.assertEqual(journal.counts(),(120,120,120))
            journal.close()

    async def test_crash_window_after_upsert_recovered_idempotently(self):
        with tempfile.TemporaryDirectory() as temp:
            path = os.path.join(temp,'j.db')
            journal = SqliteFixture(path)
            async def source(): yield {'key':'client-1','v':99}
            async def enrich(item): return {'lead':item['v']}
            fail_once = True
            async def unreliable_upsert(key, result):
                nonlocal fail_once
                await journal.upsert(key,result)
                if fail_once:
                    fail_once=False
                    raise OSError('simulated app interruption after upsert before ack')
            engine = DurableRunner(journal=journal,key_of=lambda x:x['key'],enrich=enrich,upsert=unreliable_upsert)
            with self.assertRaises(IncompleteJobError): await engine.run(source())
            self.assertEqual(journal.counts(),(1,0,1))
            journal.close()
            recovered = SqliteFixture(path)
            second = DurableRunner(journal=recovered,key_of=lambda x:x['key'],enrich=enrich,upsert=recovered.upsert)
            await second.run(empty_source())
            self.assertEqual(recovered.counts(),(1,1,1))
            recovered.close()

    async def test_explicit_cancel_replays_accepted_candidates(self):
        with tempfile.TemporaryDirectory() as temp:
            path = os.path.join(temp,'j.db')
            j = SqliteFixture(path)
            entered = asyncio.Event()
            async def source():
                for n in range(40): yield {'key':str(n),'v':n}
            async def blocked_enrich(item):
                entered.set()
                await asyncio.sleep(5)
                return {'lead':item['v']}
            runner = DurableRunner(journal=j,key_of=lambda x:x['key'],enrich=blocked_enrich,upsert=j.upsert)
            t=asyncio.create_task(runner.run(source()))
            await asyncio.wait_for(entered.wait(),1)
            t.cancel()
            with self.assertRaises(asyncio.CancelledError): await t
            total, done, leads = j.counts()
            self.assertGreater(total,0)
            self.assertEqual(done, leads)
            j.close()
            recovered=SqliteFixture(path)
            async def fast_enrich(item): return {'lead':item['v']}
            rerun=DurableRunner(journal=recovered,key_of=lambda x:x['key'],enrich=fast_enrich,upsert=recovered.upsert)
            await rerun.run(source())
            self.assertEqual(recovered.counts(),(40,40,40))
            recovered.close()

    async def test_tenant_scope(self):
        with tempfile.TemporaryDirectory() as temp:
            path=os.path.join(temp,'j.db')
            a=SqliteFixture(path,'tenant-a')
            b=SqliteFixture(path,'tenant-b')
            async def source(): yield {'key':'same','v':3}
            async def enrich(i): return i
            for store in [a,b]:
                runner=DurableRunner(journal=store,key_of=lambda x:x['key'],enrich=enrich,upsert=store.upsert)
                await runner.run(source())
                self.assertEqual(store.counts(),(1,1,1))
            a.close();b.close()

    async def test_empty_pipeline(self):
        with tempfile.TemporaryDirectory() as temp:
            j=SqliteFixture(os.path.join(temp,'j.db'))
            async def enrich(i): return i
            r=DurableRunner(journal=j,key_of=lambda x:x['key'],enrich=enrich,upsert=j.upsert)
            stats=await r.run(empty_source())
            self.assertEqual((stats.persisted,stats.failed_attempts,j.counts()),(0,0,(0,0,0)))
            j.close()
