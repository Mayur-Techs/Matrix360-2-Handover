'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {spawnSync}=require('node:child_process');
const {escape,safeLink,scheduledInstant,proposalLocal,scheduleCampaignBatch}=require('../lib/m360-linkedin-client.browser');
const resolveOverviewIntent=require('../lib/m360-overview-intent');

test('Overview routes LinkedIn media and publishing briefs into its campaign workspace',()=>{
  for(const prompt of ['Create a LinkedIn video for our business','Schedule a LinkedIn post for next week','Prepare a LinkedIn campaign'])assert.deepEqual(resolveOverviewIntent(prompt),{kind:'outreach',channel:'LinkedIn'});
  assert.deepEqual(resolveOverviewIntent('Create an email image and LinkedIn poster'),{kind:'image',channel:'LinkedIn'});
  assert.deepEqual(resolveOverviewIntent('Create WhatsApp and LinkedIn images'),{kind:'image',channel:'WhatsApp'});
});

test('LinkedIn previews escape user, provider and AI text and reject executable links',()=>{
  assert.equal(escape('<img src=x onerror="alert(1)"> & \'quote\''),'&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;quote&#39;');
  for(const url of ['javascript:alert(1)','data:text/html,<script>','http://example.com','//example.com'])assert.equal(safeLink(url),'');
  assert.equal(safeLink('https://www.linkedin.com/feed/update/urn:li:share:123'),'https://www.linkedin.com/feed/update/urn:li:share:123');
});

test('LinkedIn schedule preserves explicit local time, rejects invalid dates and DST gaps',()=>{
  assert.equal(scheduledInstant(''),null);
  assert.throws(()=>scheduledInstant('not a date'),/valid publication/);
  const script=`const {scheduledInstant}=require(${JSON.stringify(require.resolve('../lib/m360-linkedin-client.browser'))});const assert=require('node:assert/strict');assert.equal(scheduledInstant('2026-11-14T11:00'),'2026-11-14T05:30:00.000Z');`;
  const normal=spawnSync(process.execPath,['-e',script],{env:{...process.env,TZ:'Asia/Kolkata'},encoding:'utf8'});
  assert.equal(normal.status,0,normal.stderr);
  const gap=spawnSync(process.execPath,['-e',`const {scheduledInstant}=require(${JSON.stringify(require.resolve('../lib/m360-linkedin-client.browser'))});require('node:assert/strict').throws(()=>scheduledInstant('2026-03-08T02:30'),/does not exist/);`],{env:{...process.env,TZ:'America/New_York'},encoding:'utf8'});
  assert.equal(gap.status,0,gap.stderr);
});

test('AI schedule proposals require an explicit valid instant and remain draft values',()=>{
  const proposal={scheduled_at:'2026-11-17T05:30:00.000Z',time_zone:'Asia/Kolkata'};
  assert.equal(scheduledInstant(proposalLocal(proposal)),proposal.scheduled_at);
  assert.throws(()=>proposalLocal({scheduled_at:'2026-11-17T11:00'}),/explicit timezone/);
  assert.throws(()=>proposalLocal({...proposal,time_zone:'Invalid/Timezone'}));
});

test('finite campaign batch preserves successful schedules and continues after an independent failure',async()=>{
  const campaigns=[{id:'first',revision:2,title:'First post'},{id:'second',revision:4,title:'Second post'},{id:'third',revision:7,title:'Third post'}],calls=[];
  const results=await scheduleCampaignBatch(campaigns,async body=>{calls.push(body);if(body.campaign_id==='second')throw Error('Approve the current version first.');});
  assert.deepEqual(calls,[{campaign_id:'first',revision:2},{campaign_id:'second',revision:4},{campaign_id:'third',revision:7}]);
  assert.deepEqual(results.map(r=>r.queued),[true,false,true]);
  assert.equal(results[1].error,'Approve the current version first.');
  assert.equal(results.length,3);
});

test('served Marketing bundle includes valid LinkedIn code and OAuth endpoint route',()=>{
  const bundle=require('../lib/m360-marketing-client');
  assert.doesNotThrow(()=>new vm.Script(bundle));
  assert.match(bundle,/window\.Matrix360LinkedIn=\{open\}/);
  assert.doesNotMatch(bundle,/id="m360-linkedin-input-token"/);
  const config=JSON.parse(fs.readFileSync(require.resolve('../vercel.json'),'utf8'));
  assert.equal(config.rewrites.find(r=>r.source==='/api/linkedin')?.destination,'/api/marketing?action=linkedin');
});
