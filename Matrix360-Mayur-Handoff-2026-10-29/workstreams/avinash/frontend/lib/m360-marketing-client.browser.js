(() => {

  'use strict';



  const $ = id => document.getElementById(id);

  const CHANNELS = ['WhatsApp', 'Email', 'Facebook', 'Instagram', 'LinkedIn', 'X', 'YouTube', 'Google Business Profile', 'SMS', 'Website'];



  let activeTask = null;

  let activeChannel = 'Email';

  let pollInterval = null;

  let toastTimer = null;

  let calendarCursor = null;

  let calendarSelectedDate = '';

  let calendarSelectedEventId = '';

  let activeConversation = null;



  const auth = () => {

    try {

      const val = sessionStorage.getItem('matrix360_pilot_token');

      return val && +sessionStorage.getItem('matrix360_pilot_expires_at') > Date.now() ? val : null;

    } catch { return null; }

  };



  function getActiveClientInfo() {

    const wsSelect = $('workspace');

    const wsId = wsSelect?.value || sessionStorage.getItem('matrix360_active_workspace') || '';

    const selectedOpt = wsSelect?.selectedOptions?.[0] || (wsSelect && wsSelect.selectedIndex >= 0 ? wsSelect.options[wsSelect.selectedIndex] : null);

    let clientName = selectedOpt?.text ? selectedOpt.text.split('(')[0].trim() : '';

    if (!clientName || clientName.startsWith('--')) {

      clientName = 'Your Business';

    }

    return { wsId, clientName };

  }



  const ws = () => getActiveClientInfo().wsId;



  function notify(message, tone = 'info') {

    let toast = $('m360-mkt-toast');

    if (!toast) {

      toast = document.createElement('div');

      toast.id = 'm360-mkt-toast';

      toast.className = 'm360-control-toast';

      toast.setAttribute('role', 'status');

      toast.setAttribute('aria-live', 'polite');

      document.body.appendChild(toast);

    }

    clearTimeout(toastTimer);

    toast.textContent = message;

    toast.dataset.tone = tone;

    toast.hidden = false;

    toastTimer = setTimeout(() => { toast.hidden = true; }, tone === 'success' ? 8000 : 5000);

  }



  function injectMarketingStyles() {

    if ($('m360-marketing-styles')) return;

    const style = document.createElement('style');

    style.id = 'm360-marketing-styles';

    style.textContent = `

      #marketing-centre.m360-mp-hidden-section,

      #marketing-centre[data-m360-page-hidden="true"] {

        display: none !important;

      }

      #marketing-centre {

        box-sizing: border-box;

        min-height: 62vh;

        padding: clamp(20px, 3vw, 38px);

        margin: 18px 0 35px;

        border: 1px solid #9fb9b0;

        border-top: 4px solid #176451;

        border-radius: 16px;

        background: #f6faf8;

        color: #163c32;

        overflow-wrap: anywhere;

        display: grid;

        gap: 24px;

        font-family: Manrope, "DM Sans", "Segoe UI", system-ui, sans-serif;

      }

      #marketing-centre * { box-sizing: border-box; min-width: 0; }

      #marketing-centre h2 { font-size: clamp(24px, 3vw, 34px); margin: 4px 0 10px; color: #163c32; }

      #marketing-centre textarea {

        display: block;

        width: 100%;

        min-height: 120px;

        padding: 16px;

        margin: 10px 0 14px;

        border: 1px solid #708d82;

        border-radius: 10px;

        background: #ffffff;

        color: #173b31;

        font: inherit;

        resize: vertical;

      }

      #marketing-centre button {

        padding: 10px 16px;

        border: 1px solid #729286;

        border-radius: 8px;

        background: #ffffff;

        color: #173b31;

        cursor: pointer;

        font: inherit;

        white-space: normal;

        font-weight: 500;

        transition: background-color 0.15s, border-color 0.15s;

      }

      #marketing-centre button:hover { background: #eef6f3; }

      #marketing-centre button:disabled { opacity: .6; cursor: wait; }

      #marketing-centre button.primary { background: #155b49; color: #ffffff; border: none; font-weight: 600; }

      #marketing-centre button.primary:hover { background: #0f4c3c; }

      #marketing-centre button:focus-visible, #marketing-centre textarea:focus-visible, #marketing-centre input:focus-visible {

        outline: 3px solid #146bad;

        outline-offset: 3px;

      }



      .m360-kicker {

        font-size: 12px;

        font-weight: 700;

        letter-spacing: 0.08em;

        text-transform: uppercase;

        color: #176451;

        margin: 0 0 6px;

      }

      .m360-suggestions-wrap {

        display: flex;

        gap: 8px;

        flex-wrap: wrap;

        margin: 14px 0;

      }

      .m360-suggestions-wrap button {

        padding: 7px 13px;

        font-size: 13px;

        border-radius: 20px;

        background: #edf6f2;

        border: 1px solid #a5c7bb;

        color: #164338;

      }

      .m360-suggestions-wrap button:hover {

        background: #dbeef7;

        border-color: #72a9bf;

      }



      /* Cards & Containers */

      .m360-card {

        padding: 22px;

        background: #ffffff;

        border: 1px solid #c1d3cb;

        border-radius: 14px;

        box-shadow: 0 8px 24px rgba(15, 76, 69, 0.06);

      }

      .m360-card h3 {

        margin: 0 0 8px;

        font-size: 18px;

        color: #163c32;

        font-weight: 700;

      }

      .m360-subtext {

        font-size: 13.5px;

        color: #49675d;

        margin: 0 0 16px;

        line-height: 1.5;

      }

      .m360-beginner-flow {

        display: grid;

        grid-template-columns: repeat(4, minmax(0, 1fr));

        gap: 8px;

      }

      .m360-beginner-step {

        padding: 12px 14px;

        border-radius: 10px;

        border: 1px solid #bad2ca;

        background: #edf7f4;

        color: #173b31;

        font-size: 13px;

        font-weight: 650;

      }

      .m360-beginner-step span { display:block; color:#176451; font-size:11px; margin-bottom:3px; }

      .m360-conversation-bubble { margin:0; padding:11px 13px; border-radius:10px; white-space:pre-wrap; line-height:1.55; }

      .m360-conversation-bubble.user { background:#dff0ff; color:#12324a; border-left:4px solid #2b7bbb; }

      .m360-conversation-bubble.assistant { background:#e5f5ee; color:#173b31; border-left:4px solid #1d9678; }

      .m360-revision-suggestions { display:flex; gap:6px; flex-wrap:wrap; margin:8px 0; }

      .m360-revision-suggestions button { padding:6px 10px !important; font-size:12px !important; border-radius:18px !important; }

      .m360-revision-actions { display:flex; gap:8px; flex-wrap:wrap; }

      .m360-revision-actions input { flex:1 1 260px !important; min-width:220px !important; }

      .m360-revision-actions button { flex:0 0 auto; }

      .m360-advanced-tools > summary { cursor:pointer; font-weight:700; color:#174c40; }

      .m360-advanced-tools[open] > summary { margin-bottom:16px; }



      /* Neural Mesh */

      .m360-mesh-head {

        display: flex;

        justify-content: space-between;

        align-items: center;

        flex-wrap: wrap;

        gap: 12px;

        margin-bottom: 16px;

        padding-bottom: 12px;

        border-bottom: 1px solid #e1ede8;

      }

      .m360-mesh-title {

        display: flex;

        align-items: center;

        gap: 10px;

        font-size: 16px;

        font-weight: 700;

        color: #163c32;

      }

      .m360-mesh-pulse {

        width: 10px;

        height: 10px;

        background: #176451;

        border-radius: 50%;

        display: inline-block;

        box-shadow: 0 0 0 3px rgba(23, 100, 81, 0.25);

        animation: m360Pulse 2s infinite;

      }

      @keyframes m360Pulse {

        0%, 100% { transform: scale(1); opacity: 1; }

        50% { transform: scale(1.2); opacity: 0.7; }

      }

      .m360-mesh-badge {

        font-size: 11.5px;

        font-weight: 700;

        letter-spacing: 0.06em;

        text-transform: uppercase;

        color: #176451;

        background: #edf6f2;

        padding: 5px 12px;

        border-radius: 20px;

        border: 1px solid #b7d6ca;

      }

      .m360-agent-grid {

        display: grid;

        grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));

        gap: 12px;

        margin-bottom: 16px;

      }

      .m360-agent-box {

        background: #f6faf8;

        border: 1px solid #cbdcd5;

        border-radius: 12px;

        padding: 14px 16px;

      }

      .m360-agent-box.active {

        background: #edf8f4;

        border-color: #176451;

        border-width: 2px;

      }

      .m360-agent-box-head {

        display: flex;

        align-items: center;

        gap: 8px;

        margin-bottom: 6px;

      }

      .m360-agent-tag {

        font-size: 11px;

        font-weight: 700;

        padding: 2px 7px;

        border-radius: 4px;

        background: #d5e6df;

        color: #174c40;

      }

      .m360-agent-name {

        font-size: 14px;

        font-weight: 700;

        color: #163c32;

      }

      .m360-agent-status {

        font-size: 12px;

        color: #176451;

        font-weight: 600;

        margin-bottom: 4px;

      }

      .m360-agent-desc {

        font-size: 12.5px;

        color: #49675d;

        margin: 0;

        line-height: 1.45;

      }

      .m360-agent-toolbar {

        display: flex;

        gap: 8px;

        flex-wrap: wrap;

        margin-bottom: 14px;

      }

      .m360-agent-toolbar button {

        font-size: 13px;

        padding: 8px 14px;

      }



      /* Monospace Terminal */

      .m360-terminal-wrap {

        background: #0f2420;

        border: 1px solid #081614;

        border-radius: 10px;

        padding: 14px 16px;

        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;

        font-size: 12px;

        line-height: 1.6;

        color: #a7d3c4;

        max-height: 140px;

        overflow-y: auto;

      }

      .m360-term-line { margin: 2px 0; }

      .m360-term-ts { color: #5b8778; }

      .m360-term-tag { color: #4ade80; font-weight: bold; }



      /* Stepper */

      .m360-stepper-wrap {

        display: grid;

        grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));

        gap: 8px;

        margin: 6px 0 16px;

      }

      .m360-step {

        background: #ffffff;

        border: 1px solid #cbdcd5;

        border-radius: 10px;

        padding: 10px 12px;

        text-align: center;

      }

      .m360-step.done {

        background: #edf8f4;

        border-color: #8ec3b1;

      }

      .m360-step.active {

        background: #e6f4ef;

        border: 2px solid #176451;

      }

      .m360-step em {

        display: block;

        font-style: normal;

        font-size: 11px;

        font-weight: 700;

        color: #5b8778;

      }

      .m360-step.active em { color: #176451; }

      .m360-step strong {

        display: block;

        font-size: 12.5px;

        color: #163c32;

        margin: 2px 0;

      }

      .m360-step small {

        font-size: 11px;

        color: #6b8c82;

      }



      /* 10 Channel Tabs */

      .m360-tabs-bar {

        display: flex;

        gap: 6px;

        flex-wrap: wrap;

        margin-bottom: 16px;

        padding-bottom: 12px;

        border-bottom: 1px solid #d5e6df;

      }

      .m360-tab-pill {

        display: inline-flex;

        align-items: center;

        gap: 6px;

        padding: 8px 14px !important;

        font-size: 13px !important;

        border-radius: 8px !important;

        background: #ffffff !important;

        border: 1px solid #cbdcd5 !important;

        color: #163c32 !important;

        font-weight: 500 !important;

      }

      .m360-tab-pill.active {

        background: #155b49 !important;

        border-color: #155b49 !important;

        color: #ffffff !important;

        font-weight: 600 !important;

      }

      .m360-tab-pill.active .m360-tab-badge {

        background: rgba(255, 255, 255, 0.25);

        color: #ffffff;

      }

      .m360-tab-badge {

        font-size: 10.5px;

        font-weight: 700;

        padding: 2px 6px;

        border-radius: 4px;

        background: #e2ede8;

        color: #174c40;

      }



      /* 3-Gate Readiness Row */

      .m360-gates-wrap {

        display: grid;

        grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));

        gap: 12px;

        margin-bottom: 16px;

      }

      .m360-gate-item {

        background: #f6faf8;

        border: 1px solid #cbdcd5;

        border-radius: 10px;

        padding: 12px 14px;

      }

      .m360-gate-item h4 {

        margin: 0 0 4px;

        font-size: 12px;

        font-weight: 700;

        text-transform: uppercase;

        letter-spacing: 0.05em;

        color: #49675d;

      }

      .m360-gate-val {

        font-size: 13.5px;

        font-weight: 600;

      }

      .m360-gate-pass { color: #166534; }

      .m360-gate-warn { color: #92400e; }

      .m360-gate-fail { color: #991b1b; }



      /* Mockups */

      .m360-wa-mockup {

        background: #e5ddd5;

        border: 1px solid #cbdcd5;

        border-radius: 12px;

        overflow: hidden;

        margin: 12px 0;

      }

      .m360-wa-header {

        background: #075e54;

        color: #ffffff;

        padding: 10px 14px;

        font-size: 13.5px;

        font-weight: 600;

      }

      .m360-wa-bubble {

        background: #ffffff;

        margin: 14px 14px 10px;

        padding: 12px 14px;

        border-radius: 0 10px 10px 10px;

        font-size: 13.5px;

        line-height: 1.55;

        color: #111827;

        white-space: pre-wrap;

        box-shadow: 0 1px 2px rgba(0,0,0,0.1);

      }

      .m360-wa-btn-cta {

        background: #ffffff;

        margin: 0 14px 14px;

        padding: 10px 14px;

        border-radius: 8px;

        text-align: center;

        font-size: 13px;

        font-weight: 600;

        color: #0284c7;

        border-top: 1px solid #e2e8f0;

      }

      .m360-email-mockup {

        background: #ffffff;

        border: 1px solid #cbdcd5;

        border-radius: 12px;

        padding: 16px;

        margin: 12px 0;

      }

      .m360-email-field {

        font-size: 12.5px;

        color: #49675d;

        padding: 4px 0;

        border-bottom: 1px solid #f1f5f9;

      }

      .m360-email-body {

        margin: 14px 0;

        font-size: 13.5px;

        line-height: 1.6;

        color: #1e293b;

        white-space: pre-wrap;

      }



      /* Visual Diff */

      .m360-diff-viewer {

        background: #f8fafc;

        border: 1px solid #cbd5e1;

        border-radius: 10px;

        padding: 12px 14px;

        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;

        font-size: 12px;

        line-height: 1.6;

        max-height: 180px;

        overflow-y: auto;

      }

      .m360-diff-add { color: #166534; background: #dcfce7; display: block; padding: 2px 4px; }

      .m360-diff-rem { color: #991b1b; background: #fee2e2; display: block; padding: 2px 4px; }

      .m360-diff-same { color: #475569; display: block; padding: 2px 4px; }



      /* CTWA Card */

      .m360-ctwa-card {

        background: #eff6ff;

        border: 1px solid #bfdbfe;

        border-radius: 12px;

        padding: 16px 18px;

        margin: 14px 0;

      }

      .m360-ctwa-card h4 {

        margin: 0 0 6px;

        font-size: 14px;

        font-weight: 700;

        color: #1e40af;

      }



      /* Budget Sliders */

      .m360-slider-row {

        display: grid;

        grid-template-columns: 140px 1fr 100px;

        align-items: center;

        gap: 14px;

        margin: 10px 0;

      }

      .m360-slider-row input[type=range] {

        width: 100%;

        margin-inline: 0;

        accent-color: #155b49;

      }



      /* Tables */

      .m360-table {

        width: 100%;

        border-collapse: collapse;

        font-size: 12.5px;

        margin: 10px 0;

      }

      .m360-table th {

        text-align: left;

        padding: 8px 10px;

        background: #edf6f2;

        color: #164338;

        font-weight: 700;

        border-bottom: 1px solid #cbdcd5;

      }

      .m360-table td {

        padding: 8px 10px;

        border-bottom: 1px solid #e7f0ec;

        color: #1f2937;

      }



      /* Grids */

      .m360-grid-2 {

        display: grid;

        grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr));

        gap: 18px;

      }



      /* Authenticated dark workspace theme */

      body.m360-matched-crm #marketing-centre {

        background: linear-gradient(155deg, #0d2026 0%, #09171c 100%);

        color: #d9eeeb;

        border: 1px solid #29434b;

        border-top: 3px solid #43dac4;

        box-shadow: 0 24px 60px rgba(0, 0, 0, .22);

      }

      body.m360-matched-crm #marketing-centre h2,

      body.m360-matched-crm #marketing-centre h3,

      body.m360-matched-crm #marketing-centre h4,

      body.m360-matched-crm #marketing-centre label,

      body.m360-matched-crm #marketing-centre strong,

      body.m360-matched-crm #marketing-centre .m360-mesh-title,

      body.m360-matched-crm #marketing-centre .m360-agent-name,

      body.m360-matched-crm #marketing-centre .m360-step strong {

        color: #ecfffb !important;

      }

      body.m360-matched-crm #marketing-centre .m360-kicker,

      body.m360-matched-crm #marketing-centre .m360-agent-status,

      body.m360-matched-crm #marketing-centre .m360-step.active em {

        color: #58e5cf !important;

      }

      body.m360-matched-crm #m360-mkt-context,

      body.m360-matched-crm #m360-mkt-status,

      body.m360-matched-crm #marketing-centre .m360-subtext,

      body.m360-matched-crm #marketing-centre .m360-agent-desc,

      body.m360-matched-crm #marketing-centre .m360-step small,

      body.m360-matched-crm #marketing-centre .m360-step em {

        color: #9ab4b5 !important;

      }

      body.m360-matched-crm #marketing-centre .m360-card,

      body.m360-matched-crm #marketing-centre .m360-agent-box,

      body.m360-matched-crm #marketing-centre .m360-step,

      body.m360-matched-crm #marketing-centre .m360-gate-item,

      body.m360-matched-crm #marketing-centre .m360-email-mockup,

      body.m360-matched-crm #marketing-centre .m360-diff-viewer {

        background: #11262c !important;

        color: #d9eeeb !important;

        border-color: #2c4850 !important;

        box-shadow: none;

      }

      body.m360-matched-crm #marketing-centre .m360-beginner-step {

        background:#132f34;

        border-color:#2c5960;

        color:#dff8f4;

      }

      body.m360-matched-crm #marketing-centre .m360-beginner-step span { color:#62dfcc; }

      body.m360-matched-crm #marketing-centre .m360-conversation-bubble.user {

        background:#122f46 !important;

        color:#dff3ff !important;

        border-left-color:#55b6ec;

      }

      body.m360-matched-crm #marketing-centre .m360-conversation-bubble.assistant {

        background:#13352f !important;

        color:#e5fff9 !important;

        border-left-color:#4be0c7;

      }

      body.m360-matched-crm #marketing-centre .m360-wa-bubble,

      body.m360-matched-crm #marketing-centre .m360-wa-btn-cta,

      body.m360-matched-crm #marketing-centre #m360-channel-custom-view > div {

        background:#132a31 !important;

        color:#e3f5f3 !important;

        border-color:#34525a !important;

      }

      body.m360-matched-crm #marketing-centre .m360-wa-mockup { background:#0a191e !important; border-color:#34525a !important; }

      body.m360-matched-crm #marketing-centre .m360-email-field { color:#a8c9c7 !important; }

      body.m360-matched-crm #marketing-centre .m360-advanced-tools > summary { color:#a7cbc6; }

      body.m360-matched-crm #marketing-centre .m360-agent-box.active,

      body.m360-matched-crm #marketing-centre .m360-step.active {

        background: #12332f !important;

        border-color: #43dac4 !important;

      }

      body.m360-matched-crm #marketing-centre .m360-mesh-head,

      body.m360-matched-crm #marketing-centre .m360-tabs-bar,

      body.m360-matched-crm #marketing-centre .m360-email-field,

      body.m360-matched-crm #marketing-centre .m360-table td {

        border-color: #29434b !important;

      }

      body.m360-matched-crm #marketing-centre button,

      body.m360-matched-crm #marketing-centre .m360-tab-pill,

      body.m360-matched-crm #marketing-centre input:not([type=range]),

      body.m360-matched-crm #marketing-centre textarea,

      body.m360-matched-crm #marketing-centre select {

        background: #0b1b21 !important;

        color: #dff8f4 !important;

        border-color: #35535c !important;

      }

      body.m360-matched-crm #marketing-centre button:hover,

      body.m360-matched-crm #marketing-centre .m360-tab-pill:hover {

        background: #17343b !important;

        border-color: #4b7777 !important;

      }

      body.m360-matched-crm #marketing-centre button.primary,

      body.m360-matched-crm #marketing-centre .m360-tab-pill.active {

        background: linear-gradient(135deg, #20b8a6, #13867e) !important;

        color: #ffffff !important;

        border-color: transparent !important;

      }

      body.m360-matched-crm #marketing-centre .m360-mesh-badge,

      body.m360-matched-crm #marketing-centre .m360-agent-tag,

      body.m360-matched-crm #marketing-centre .m360-tab-badge {

        background: #183b39 !important;

        color: #72ead8 !important;

        border-color: #315d59 !important;

      }

      body.m360-matched-crm #marketing-centre .m360-table th {

        background: #163137;

        color: #bfe9e3;

        border-color: #35535c;

      }

      body.m360-matched-crm #marketing-centre .m360-table td,

      body.m360-matched-crm #marketing-centre .m360-email-body,

      body.m360-matched-crm #marketing-centre #m360-strategy-content,

      body.m360-matched-crm #marketing-centre #m360-ab-test-content {

        color: #c6dcda !important;

      }

      body.m360-matched-crm #marketing-centre .m360-terminal-wrap {

        background: #06110f;

        border-color: #28443e;

      }

      body.m360-matched-crm #marketing-centre input::placeholder,

      body.m360-matched-crm #marketing-centre textarea::placeholder { color: #71898c; opacity: 1; }



      @media(max-width: 760px) {

        #marketing-centre { padding: 18px; }

        .m360-slider-row { grid-template-columns: 1fr; gap: 6px; }

        .m360-beginner-flow { grid-template-columns: 1fr 1fr; }

      }

    `;

    document.head.appendChild(style);

  }



  function mountMarketingCenter() {

    const leadsEl = document.getElementById('leads') || document.getElementById('pipeline-title')?.closest('section, .card, div');

    const mainContainer = (leadsEl && leadsEl.parentElement) || document.querySelector('main, .dashboard-main, .workspace-main, .main-content, .content-area') || document.body;

    if ($('marketing-centre')) return;

    injectMarketingStyles();



    const host = document.createElement('section');

    host.id = 'marketing-centre';

    host.className = 'card m360-marketing-section m360-mkt-container';

    host.setAttribute('data-m360-page', 'marketing');

    host.setAttribute('aria-labelledby', 'm360-mkt-title');



    // Immediately hide if not on the marketing page

    const isMarketing = (window.location.hash || '').toLowerCase().includes('marketing') || (new URLSearchParams(window.location.search).get('page') === 'marketing');

    if (!isMarketing) {

      host.classList.add('m360-mp-hidden-section');

      host.setAttribute('data-m360-page-hidden', 'true');

    }



    host.innerHTML = `

      <!-- Top Title & Kicker matching Overview -->

      <div>

        <p class="m360-kicker">YOUR MATRIX360 OUTREACH ASSISTANT</p>

        <h2 id="m360-mkt-title">Campaign workspace</h2>

        <p class="m360-subtext">Review a campaign prepared in Overview AI or start a new brief here.</p><p id="m360-campaign-summary"></p><a href="/client-dashboard.html?page=dashboard#overview" data-outreach-page="dashboard">Open Overview AI</a> · <a href="/client-dashboard.html?page=research#market-research" data-outreach-page="research">Research, budget and calendar</a>

      </div>



      <!-- Safety Disclaimer matching Overview #m360-control-context -->

      <p id="m360-mkt-context" style="font-size:13px; color:#49675d; margin:6px 0 12px;">Your request uses only this authorized workspace. Nothing is published or sent externally without explicit provider authorization.</p>



      <!-- Live Status Line matching Overview #m360-control-status -->

      <p id="m360-mkt-status" role="status" aria-live="polite" style="display:flex; align-items:center; gap:9px; font-weight:650; min-height:24px; color:#163c32;">

        <span id="m360-mkt-spinner" class="m360-control-spinner" hidden></span>

        <span id="m360-mkt-status-text">Ready when you are.</span>

      </p>



      <div class="m360-beginner-flow" aria-label="Campaign setup steps">

        <div class="m360-beginner-step"><span>STEP 1</span>Describe your goal</div>

        <div class="m360-beginner-step"><span>STEP 2</span>Review AI messages</div>

        <div class="m360-beginner-step"><span>STEP 3</span>Choose audience or test email</div>

        <div class="m360-beginner-step"><span>STEP 4</span>Approve and send</div>

      </div>



      <section class="m360-card" aria-labelledby="m360-conversation-title">

        <h3 id="m360-conversation-title" style="margin:0 0 6px;">1. Tell the AI what you want to achieve</h3>

        <p class="m360-subtext">Tell us what the campaign is about. Outreach uses your saved Company Details to prepare the draft.</p>

        <div id="m360-conversation-history" role="log" aria-live="polite" style="display:grid;gap:8px;margin:12px 0;"></div>

        <form id="m360-conversation-form">

          <label for="m360-conversation-input">What should the campaign be about?</label>

          <textarea id="m360-conversation-input" maxlength="5000" required placeholder="Example: Generate qualified enquiries for our industrial estate through email and WhatsApp next month."></textarea>

          <div class="m360-suggestions-wrap" aria-label="Campaign examples"><button type="button" data-campaign-suggestion="Generate qualified enquiries using email and WhatsApp.">Get enquiries</button><button type="button" data-campaign-suggestion="Promote our approved offer to existing opted-in customers.">Promote an offer</button><button type="button" data-campaign-suggestion="Create an awareness campaign using our approved Company Details.">Build awareness</button><button type="button" data-campaign-suggestion="Launch targeted bulk email campaign using verified Brevo relay to introduce our primary solution to opted-in prospects.">🚀 Bulk Email Blast</button><button type="button" data-campaign-suggestion="Generate high-converting Click-to-WhatsApp conversation starter with instant qualification hook.">💬 WhatsApp Lead Flow</button><button type="button" data-campaign-suggestion="Create multi-channel social campaign with feed (1:1) and story (9:16) creative hooks and clear CTA.">📸 Instagram/FB Visual</button><button type="button" data-campaign-suggestion="Execute professional B2B outreach tailored to C-suite and VP decision-makers with strategic value proposition.">💼 LinkedIn Executive</button></div>

          <div style="display:flex;gap:8px;flex-wrap:wrap;"><button class="primary" type="submit">Create my campaign</button><button id="m360-conversation-new" type="button">Start over</button></div>

        </form>

      </section>



      <!-- Multi-Agent Inter-Communication Console -->

      <details class="m360-card m360-advanced-tools">

        <summary>Advanced coordination tools</summary>

        <div class="m360-mesh-head">

          <div class="m360-mesh-title">

            <span class="m360-mesh-pulse"></span>

            <span>Campaign coordination</span>

          </div>

          <span class="m360-mesh-badge">WORKFLOW TOOLS</span>

        </div>

        <div class="m360-agent-grid">

          <div class="m360-agent-box active" id="box-agent-mkt">

            <div class="m360-agent-box-head">

              <span class="m360-agent-tag">MKT</span>

              <span class="m360-agent-name">Outreach AI</span>

            </div>

            <div class="m360-agent-status">Available; dependency status remains evidence-based</div>

            <p class="m360-agent-desc">Coordinates campaigns, surgical channel copy, 3-gate readiness &amp; budget math.</p>

          </div>

          <div class="m360-agent-box" id="box-agent-overview">

            <div class="m360-agent-box-head">

              <span class="m360-agent-tag">OVR</span>

              <span class="m360-agent-name">Overview AI</span>

            </div>

            <div class="m360-agent-status">Campaign telemetry summary available on demand</div>

            <p class="m360-agent-desc">Synchronizes live step telemetry, commercial goals &amp; global client routing.</p>

          </div>

          <div class="m360-agent-box" id="box-agent-leads">

            <div class="m360-agent-box-head">

              <span class="m360-agent-tag">LEAD</span>

              <span class="m360-agent-name">Leads &amp; Pipeline AI</span>

            </div>

            <div class="m360-agent-status">Authorized CRM and showcase pipeline refresh available</div>

            <p class="m360-agent-desc">Supplies verified CRM lead snapshots with email/phone &amp; opt-in consent states.</p>

          </div>

          <div class="m360-agent-box" id="box-agent-content">

            <div class="m360-agent-box-head">

              <span class="m360-agent-tag">CONT</span>

              <span class="m360-agent-name">Content Creation AI</span>

            </div>

            <div class="m360-agent-status">Saved Content Studio library query available</div>

            <p class="m360-agent-desc">Supplies key visuals, reels storyboards &amp; brand asset library.</p>

          </div>

        </div>

        <div class="m360-agent-toolbar">

          <button type="button" id="btn-bus-leads">Request Audience from Leads AI</button>

          <button type="button" id="btn-bus-content">Request Assets from Content AI</button>

          <button type="button" id="btn-bus-overview">Broadcast Telemetry to Overview AI</button>

          <button type="button" class="primary" id="btn-bus-full-sync">Run Multi-Engine Coordination</button>

        </div>

        <!-- Full-Duplex Multi-Agent Team Supervision & Review Controls -->
        <div class="m360-agent-supervisor-bar" style="margin:12px 0; padding:10px 14px; background:var(--ws-soft, #f0fdf4); border:1px solid var(--ws-line, #86efac); border-radius:8px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
          <div>
            <span style="font-size:11px; background:var(--ws-button, #166534); color:#fff; padding:2px 8px; border-radius:10px; font-weight:700;">OVERVIEW AI &bull; SUPERVISOR / BOSS</span>
            <div id="m360-boss-review-status" style="font-size:12px; font-weight:600; color:var(--ws-accent, #14532d); margin-top:3px;">Review Status: Deliverables Ready for Review</div>
          </div>
          <div style="display:flex; gap:8px;">
            <button type="button" id="m360-btn-team-agree" style="padding:5px 12px; font-size:11.5px; font-weight:700; background:#16a34a; color:#fff; border:none; border-radius:6px; cursor:pointer;">Boss: Agree &amp; Approve</button>
            <button type="button" id="m360-btn-team-disagree" style="padding:5px 12px; font-size:11.5px; font-weight:700; background:#ea580c; color:#fff; border:none; border-radius:6px; cursor:pointer;">Boss: Request Revision</button>
          </div>
        </div>

        <!-- Live Inter-Agent Dialogue Stream -->
        <div style="margin:10px 0; padding:10px; background:var(--ws-panel, #ffffff); border:1px solid var(--ws-line, #cbd5e1); border-radius:8px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <strong style="font-size:12px; color:var(--ws-text, #1e293b);">Live Inter-Agent Dialogue &amp; Directive Stream</strong>
            <span style="font-size:10.5px; color:var(--ws-muted, #64748b);">Overview Boss &harr; Leads &harr; Content &harr; Outreach</span>
          </div>
          <div id="m360-team-dialogue-list" style="max-height:140px; overflow-y:auto; display:grid; gap:6px; font-size:12px; margin-bottom:8px;">
            <div style="padding:6px 8px; background:var(--ws-soft, #f8fafc); border-radius:4px; color:var(--ws-text, #334155);"><strong>Overview AI (Boss):</strong> Team initialized. Specialist task assignments and deliverables synchronized.</div>
          </div>
          <form id="m360-team-msg-form" style="display:flex; gap:8px;">
            <input id="m360-team-msg-input" placeholder="Type directive from Overview Boss to specialists..." style="flex:1; padding:6px 10px; font-size:12px; background:var(--ws-panel, #ffffff); color:var(--ws-text, #1e293b); border:1px solid var(--ws-line, #cbd5e1); border-radius:6px;" />
            <button type="submit" style="padding:6px 12px; font-size:12px; background:var(--ws-button, #0f766e); color:#fff; border:none; border-radius:6px; font-weight:600; cursor:pointer;">Send Directive</button>
          </form>
        </div>

        <p style="margin:8px 0 0;font-size:12px;color:#526b5f"><strong>Audience</strong> refreshes this campaign from Leads &amp; Pipeline. <strong>Assets</strong> attaches saved Content Studio versions, or keeps the generated text plan when none exist. <strong>Telemetry</strong> prepares the current campaign summary for Overview. <strong>Coordination</strong> runs all three safely.</p>

        <div class="m360-terminal-wrap" id="m360-terminal-logs">

          <div class="m360-term-line"><span class="m360-term-ts">[READY]</span> <span class="m360-term-tag">[Outreach]</span> Waiting for an authenticated task. Dependencies are reported from API results only.</div>

        </div>

      </details>



      <!-- Step Progress Pipeline -->

      <details class="m360-card"><summary>Campaign activity</summary><div class="m360-stepper-wrap" id="m360-step-stepper">

        <div class="m360-step" id="step-accepted"><em>01</em><strong>Accepted</strong><small>Waiting</small></div>

        <div class="m360-step" id="step-requesting_leads"><em>02</em><strong>Requesting Leads</strong><small>Waiting</small></div>

        <div class="m360-step" id="step-audience_received"><em>03</em><strong>Audience Result</strong><small>Waiting</small></div>

        <div class="m360-step" id="step-requesting_content"><em>04</em><strong>Requesting Content</strong><small>Waiting</small></div>

        <div class="m360-step" id="step-assets_ready"><em>05</em><strong>Assets Result</strong><small>Waiting</small></div>

        <div class="m360-step" id="step-draft_ready"><em>06</em><strong>Draft Ready</strong><small>Waiting</small></div>

      </div></details>



      <!-- Whiteboard & Strategy Row -->

      <div class="m360-grid-2">

        <div class="m360-card" id="m360-strategy-card">

          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">

            <h3 style="margin:0;">Campaign strategy</h3>

            <span class="m360-tab-badge" id="m360-profile-badge">B2C Residential / Affinity</span>

          </div>

          <div style="display:flex; align-items:center; gap:8px; margin-bottom:14px; font-size:13px; color:#174c40;">

            <span>Active Client Workspace:</span>

            <strong id="m360-active-client-label">Your Business</strong>

          </div>

          <!-- Targeting Strategy & Audience Persona Mode Switcher -->
          <div style="margin-bottom:12px; padding:10px 12px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px;">
            <span style="display:block; font-size:11.5px; font-weight:700; color:#475569; margin-bottom:6px; text-transform:uppercase; letter-spacing:0.5px;">Targeting Strategy &amp; Audience Persona Mode:</span>
            <div style="display:flex; gap:8px; flex-wrap:wrap;">
              <button type="button" id="m360-btn-persona-b2b" style="padding:6px 12px; font-size:12px; font-weight:600; border-radius:6px; cursor:pointer; border:1px solid #cbd5e1; background:#ffffff; color:#334155;">🏢 B2B Industrial / Enterprise (e.g. Lakhotia)</button>
              <button type="button" id="m360-btn-persona-b2c" style="padding:6px 12px; font-size:12px; font-weight:600; border-radius:6px; cursor:pointer; border:1px solid #cbd5e1; background:#ffffff; color:#334155;">🏡 B2C Residential &amp; Hometown Affinity (e.g. Shree Heights)</button>
            </div>
          </div>

          <div id="m360-strategy-content" style="font-size:13.5px; line-height:1.55; color:#334155;">

            <!-- Rendered dynamically -->

          </div>

          <!-- Explainable AI Evidence Drawer -->
          <details style="margin-top:14px; padding:10px 12px; background:#f0fdf4; border:1px solid #bbf7d0; border-radius:8px; font-size:12.5px;">
            <summary style="font-weight:700; color:#166534; cursor:pointer;">🔍 Strategy Evidence &amp; Citations (Explainable AI)</summary>
            <div id="m360-strategy-evidence-body" style="margin-top:8px; font-size:12px; line-height:1.6; color:#14532d;">
              <!-- Rendered dynamically -->
            </div>
          </details>

          <div style="margin-top:12px; display:flex; justify-content:flex-end;">
            <button type="button" id="m360-btn-export-pitch-deck" style="font-size:12px; padding:6px 14px; background:#0f766e; color:#ffffff; border:none; border-radius:6px; cursor:pointer; font-weight:600;">📄 Export Boardroom Pitch Deck</button>
          </div>

        </div>



        <!-- Audience & Assets Picker -->

        <div class="m360-card">

          <h3 style="margin:0 0 4px;">Audience readiness</h3>

          <p id="m360-leads-summary-text" role="status">No audience loaded.</p>

          <p><a href="/client-dashboard.html?page=leads#leads" data-outreach-page="leads">Review contacts and permissions in Leads &amp; Pipeline</a></p>

          <details><summary>Browse contacts</summary>

          <label for="m360-audience-filter">Show contacts</label>

          <select id="m360-audience-filter"><option value="all">All contacts</option><option value="eligible">Eligible for the selected channel</option><option value="permission">Missing permission</option><option value="identifier">Missing contact details</option><option value="excluded">Suppressed or unsubscribed</option></select>

          <div style="display:flex; gap:10px; margin-bottom:10px;">

            <input type="text" id="m360-lead-search" placeholder="Filter contacts by name, email, or segment..." style="width:100%; padding:8px 12px; border:1px solid #cbdcd5; border-radius:6px; font-size:12.5px;">

          </div>

          <div style="max-height:180px; overflow-y:auto; border:1px solid #cbdcd5; border-radius:8px;">

            <table class="m360-table" id="m360-leads-table">

              <thead>

                <tr>

                  <th>Contact</th>

                  <th>Channel Identifier</th>

                  <th>Permission for selected channel</th>

                  <th>Affinity Segment</th>

                </tr>

              </thead>

              <tbody id="m360-leads-tbody">

                <!-- Rendered dynamically -->

              </tbody>

            </table>

          </div>

          </details>

        </div>

      </div>



      <!-- 10-Channel Dedicated Workspaces -->

      <div class="m360-card" id="m360-channels-section">

        <h3 style="margin:0 0 4px;">2. Review and improve each message</h3>

        <p class="m360-subtext">Choose a channel. AI writes from the campaign goal and approved Company Details; your rewrite changes only this channel.</p>



        <!-- Channel Tabs -->

        <div class="m360-tabs-bar" id="m360-channel-tabs">

          <!-- Rendered dynamically -->

        </div>



        <!-- 3-Gate Readiness Row -->

        <div class="m360-gates-wrap" id="m360-gate-container">

          <!-- Rendered dynamically -->

        </div>



        <!-- Channel Workspace Content (Split View: Preview vs Diff) -->

        <div class="m360-grid-2">

          <div>

            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">

              <span style="font-weight:700; font-size:14px; color:#163c32;" id="m360-active-channel-label">WhatsApp Campaign Workspace</span>

              <span class="m360-tab-badge" id="m360-active-version-pill">v1 Draft for Review</span>

            </div>

            

            <button type="button" id="m360-edit-draft">Edit draft</button>

            <div id="m360-channel-custom-view">

              <!-- Rendered dynamically -->

            </div>



            <div style="margin-top:16px;">

              <label for="m360-revision-input" style="font-weight:700; font-size:13px; color:#173b31; display:block; margin-bottom:5px;">Ask AI to improve this message</label>

              <div class="m360-revision-suggestions"><button type="button" data-revision-suggestion="Make it shorter and clearer.">Shorter</button><button type="button" data-revision-suggestion="Make it warmer and more conversational while keeping every claim factual.">Friendlier</button><button type="button" data-revision-suggestion="Make the call to action stronger without adding unsupported claims.">Stronger action</button></div>

              <div class="m360-revision-actions">

                <input type="text" id="m360-revision-input" placeholder="Example: Make this clearer for first-time industrial buyers." style="flex:1; padding:9px 12px; border:1px solid #708d82; border-radius:8px; font-size:13px;">

                <button type="button" class="primary" id="btn-apply-revision">Rewrite with AI</button>

                <button type="button" id="btn-approve-channel">Approve this version</button>

                <button type="button" id="btn-launch-channel" class="primary" style="display:none; font-size:13px; padding:9px 14px;">Launch Channel</button>

                <button type="button" id="btn-test-preview" style="display:none; font-size:13px; padding:9px 14px; background:#075e54; color:#fff; border:none; border-radius:8px; font-weight:600; cursor:pointer;">Test on My Device</button>

              </div>

            </div>

          </div>



          <div>

            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">

              <span style="font-weight:700; font-size:14px; color:#163c32;"></span>

              <span style="font-size:11px; color:#6b8c82;"></span>

            </div>

            <details><summary>Changes from previous version</summary><div class="m360-diff-viewer" id="m360-diff-viewer">

              <span class="m360-diff-same">Initial version created. No revisions recorded yet.</span>

            </div></details>



            <!-- Email-to-CTWA Bridge -->

            <div class="m360-ctwa-card" id="m360-ctwa-card">

              <h4>Email-to-Click-to-WhatsApp (CTWA) Opt-In Bridge</h4>

              <p style="font-size:12.5px; color:#1e3a8a; margin:0 0 10px; line-height:1.5;" id="m360-ctwa-summary">

                No verified bridge audience is available yet.

              </p>

              <button type="button" id="btn-preview-ctwa-bridge" style="background:#ffffff; border-color:#93c5fd; color:#1e40af; font-size:12.5px; padding:6px 12px;">Preview CTWA Bridge Email</button>

            </div>

          </div>

        </div>

      </div>



      <!-- Bayesian Budget Saturation & A/B Testing -->

      <div class="m360-card" id="m360-budget-section">

        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:8px;">

          <h3 style="margin:0;">Budget &amp; test planning</h3>

          <span class="m360-tab-badge" style="background:#fee2e2; color:#991b1b; font-weight:700;">Planning estimate · not measured results</span>

        </div>

        <p class="m360-subtext">Explore how budget and duration affect planning estimates. These are assumptions, not measured campaign results.</p>



        <div class="m360-grid-2">

          <div>

            <div class="m360-slider-row">

              <label style="font-size:13px; font-weight:600; color:#173b31;">Campaign Budget:</label>

              <input type="range" id="m360-slider-budget" min="10000" max="100000" step="5000" value="35000">

              <span style="font-weight:700; color:#155b49;" id="m360-val-budget">INR 35,000</span>

            </div>

            <div class="m360-slider-row">

              <label style="font-size:13px; font-weight:600; color:#173b31;">Duration (Days):</label>

              <input type="range" id="m360-slider-duration" min="7" max="60" step="1" value="30">

              <span style="font-weight:700; color:#155b49;" id="m360-val-duration">30 Days</span>

            </div>



            <div id="m360-budget-scenarios-card" style="margin-top:14px;">

              <!-- Rendered dynamically -->

            </div>

          </div>



          <div>

            <div class="m360-card" id="m360-ab-test-card" style="background:#f8fafc; border:1px solid #cbd5e1; box-shadow:none;">

              <h4 style="margin:0 0 6px; font-size:14px; color:#1e293b;">Plan a message comparison</h4>

              <p style="font-size:12px; color:#64748b; margin:0 0 10px;">Statistical power 80%, significance alpha 5%, minimum duration 14 days.</p>

              <div id="m360-ab-test-content" style="font-size:12.5px; line-height:1.6; color:#334155;">

                <!-- Rendered dynamically -->

              </div>

            </div>

          </div>

        </div>

      </div>



      <!-- Campaign Calendar & Connections -->

      <div class="m360-grid-2">

        <div class="m360-card">

          <h3 style="margin:0 0 4px;">Campaign Calendar &amp; Journeys</h3>

          <p class="m360-subtext">Approved schedule and staging. Outbound execution is gated until providers are connected.</p>

          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin:10px 0;">

            <button type="button" id="m360-calendar-prev" aria-label="Previous month">Previous</button>

            <strong id="m360-calendar-month">Campaign month</strong>

            <button type="button" id="m360-calendar-next" aria-label="Next month">Next</button>

          </div>

          <div id="m360-calendar-grid" role="grid" aria-label="Campaign calendar" style="display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px;"></div>

          <p id="m360-calendar-summary" role="status" style="font-size:12px;color:#49675d;margin:10px 0;">No campaigns scheduled.</p>

          <section id="m360-calendar-editor" aria-labelledby="m360-calendar-editor-title" style="margin-top:10px;padding:12px;border:1px solid #cbdcd5;border-radius:8px;">

            <h4 id="m360-calendar-editor-title" style="margin:0 0 8px;">Add campaign</h4>

            <div id="m360-calendar-day-events" style="font-size:12px;margin-bottom:8px;"></div>

            <form id="m360-calendar-form">

              <label>Campaign title<input id="m360-calendar-title" maxlength="160" required></label>

              <label>Channel<select id="m360-calendar-channel">${CHANNELS.map(channel => `<option>${channel}</option>`).join('')}</select></label>

              <label>Date<input id="m360-calendar-date" type="date" required></label>

              <label>Status<select id="m360-calendar-status"><option value="draft">Draft</option><option value="pending_approval">Pending approval</option><option value="approved">Approved</option><option value="pending_provider_connection">Waiting for provider</option><option value="scheduled">Scheduled</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select></label>

              <div style="display:flex;gap:8px;margin-top:8px;"><button type="submit" class="primary" id="m360-calendar-save">Add campaign</button><button type="button" id="m360-calendar-new">New</button><button type="button" id="m360-calendar-remove" hidden>Remove</button></div>

            </form>

          </section>

          <section aria-labelledby="m360-journey-title" style="margin-top:12px;padding:12px;border:1px solid #cbdcd5;border-radius:8px;">

            <h4 id="m360-journey-title" style="margin:0 0 8px;">Customer journey rules</h4>

            <form id="m360-journey-form">

              <label>Rule name<input id="m360-journey-name" maxlength="120" required placeholder="Notify owner after an email click"></label>

              <label>Verified trigger<select id="m360-journey-trigger"><option value="email_delivered">Email delivered</option><option value="email_clicked">Email clicked</option><option value="lead_replied">Lead replied</option><option value="campaign_provider_accepted">Provider accepted campaign</option></select></label>

              <label>Action<select id="m360-journey-action"><option value="notify_owner">Notify owner</option><option value="create_crm_followup">Create CRM follow-up</option><option value="stop_campaign">Stop campaign</option></select></label>

              <label>Delay hours<input id="m360-journey-delay" type="number" min="0" max="720" value="0"></label>

              <button type="submit">Add journey rule</button>

            </form>

            <div id="m360-journey-list" style="display:grid;gap:6px;margin-top:8px;"></div>

            <small>Rules execute only from verified provider/CRM events. Draft rules do not send messages.</small>

          </section>

          <small style="color:#6b8c82;">Status: <strong>dispatched: false</strong> (Review and connection required before dispatch).</small>

        </div>



        <div class="m360-card">

          <dialog id="m360-draft-editor" aria-label="Edit channel draft">

            <form id="m360-draft-edit-form">

              <h3>Edit draft</h3>

              <label id="m360-edit-subject-label">Subject or title<input id="m360-edit-subject" maxlength="150"></label>

              <label id="m360-edit-preheader-label">Email preview text<input id="m360-edit-preheader" maxlength="120"></label>

              <label>Message<textarea id="m360-edit-body" rows="8" required></textarea></label>

              <p id="m360-draft-edit-status" role="status">Saving creates a version for review.</p>

              <button type="button" id="m360-cancel-draft-edit">Cancel</button>

              <button type="submit" id="m360-save-draft-edit">Save as new draft</button>

            </form>

          </dialog><dialog id="m360-email-preview" aria-label="Email preview"><form method="dialog"><button>Close preview</button></form><h3>Email preview</h3><div id="m360-email-preview-content"></div></dialog>

          <h3 style="margin:0 0 4px;">3. Send a test email</h3>

          <p class="m360-subtext">Approve the Email message, enter the recipient’s email address, and send one message. No contact list is needed for this test.</p>

          <div style="display:grid; gap:8px; margin-bottom:14px;">

            <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 12px; background:var(--ws-soft, #f6faf8); border:1px solid var(--ws-line, #cbdcd5); border-radius:8px; font-size:12.5px;">
              <div>
                <span style="font-weight:600; color:var(--ws-accent, #174c40);">🟢 Meta WhatsApp Cloud API</span>
                <div id="m360-wa-provider-status" style="color:#92400e; font-weight:600; font-size:11.5px; margin-top:2px;">Disconnected (Setup Required)</div>
              </div>
              <div style="display:flex; gap:6px;">
                <button type="button" id="m360-btn-open-wa-config" style="padding:5px 12px; font-size:11px; font-weight:600; background:#075e54; color:#ffffff; border:none; border-radius:4px; cursor:pointer;">🔑 Configure Key</button>
                <button type="button" id="m360-btn-verify-wa" style="padding:5px 10px; font-size:11px; font-weight:600; background:#0f766e; color:#ffffff; border:none; border-radius:4px; cursor:pointer;">Verify</button>
              </div>
            </div>

            <!-- WhatsApp Credential Vault & Guide Drawer -->
            <div id="m360-wa-config-vault" class="m360-provider-vault" style="display:none; padding:14px; background:var(--ws-panel, #ffffff); border:2px solid var(--ws-accent, #075e54); border-radius:10px; margin-top:8px; color:var(--ws-text, #1e293b);">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                <strong style="font-size:13px; color:var(--ws-accent, #075e54);">📱 WhatsApp Campaign Setup &amp; Delivery</strong>
                <span style="font-size:10.5px; background:var(--ws-soft, #ecfdf5); color:var(--ws-accent, #047857); border:1px solid var(--ws-line, #a7f3d0); padding:2px 8px; border-radius:10px; font-weight:700;">AES-256-GCM SECURED</span>
              </div>

              <!-- Setup Mode Tabs -->
              <div style="display:flex; gap:6px; margin-bottom:12px; border-bottom:1px solid var(--ws-line, #cbd5e1); padding-bottom:8px;">
                <button type="button" id="m360-wa-tab-managed" style="padding:6px 12px; font-size:11.5px; font-weight:700; background:var(--ws-button, #075e54); color:#ffffff; border:none; border-radius:6px; cursor:pointer;">✨ Done-For-You Managed (Zero Effort)</button>
                <button type="button" id="m360-wa-tab-byok" style="padding:6px 12px; font-size:11.5px; font-weight:600; background:var(--ws-soft, #f1f5f9); color:var(--ws-muted, #475569); border:1px solid var(--ws-line, #cbd5e1); border-radius:6px; cursor:pointer;">🔑 Developer BYOK (Meta Cloud API)</button>
              </div>

              <!-- Tab 1: Managed Concierge Form -->
              <div id="m360-wa-panel-managed">
                <p style="margin:0 0 10px; font-size:11.5px; color:var(--ws-muted, #475569); line-height:1.45;">No Meta developer accounts, no API tokens, and zero technical setup. Authorize Matrix 360 AI to manage broadcasts to your verified CRM leads through our verified platform gateway. Customer replies go directly to your personal WhatsApp number.</p>
                <form id="m360-wa-managed-form">
                  <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                    <label style="display:block; font-size:11.5px; font-weight:600; color:var(--ws-text, #1e293b); margin-bottom:3px;">Your Business / Brand Display Name
                      <input type="text" id="m360-wa-managed-biz-name" required placeholder="e.g. Lakhotia Industrial Hub" style="width:100%; box-sizing:border-box; padding:6px 9px; font-size:12px; background:var(--ws-panel, #ffffff); color:var(--ws-text, #1e293b); border:1px solid var(--ws-line, #cbd5e1); border-radius:6px;" />
                    </label>
                    <label style="display:block; font-size:11.5px; font-weight:600; color:var(--ws-text, #1e293b); margin-bottom:3px;">WhatsApp Number to Receive Lead Replies
                      <input type="text" id="m360-wa-managed-reply-phone" required placeholder="e.g. +91 98300 12345" style="width:100%; box-sizing:border-box; padding:6px 9px; font-size:12px; background:var(--ws-panel, #ffffff); color:var(--ws-text, #1e293b); border:1px solid var(--ws-line, #cbd5e1); border-radius:6px; font-family:monospace;" />
                    </label>
                  </div>
                  <div style="margin-top:10px; padding:10px; background:var(--ws-soft, #f0fdf4); border:1px solid var(--ws-line, #bbf7d0); border-radius:6px; font-size:11.5px;">
                    <label style="display:flex; align-items:flex-start; gap:8px; cursor:pointer; color:var(--ws-text, #14532d); font-weight:500; line-height:1.4;">
                      <input type="checkbox" id="m360-wa-managed-consent-check" required style="margin-top:2px;" />
                      <span><strong>Campaign Delegation &amp; SLA Agreement:</strong> I authorize Matrix 360 AI Campaign Concierge to broadcast approved marketing copy and project brochures to my CRM leads on my behalf. Guaranteed 48-Hour Connection SLA with zero client technical effort.</span>
                    </label>
                  </div>
                  <div style="display:flex; gap:8px; margin-top:10px; justify-content:flex-end;">
                    <button type="button" id="m360-btn-cancel-wa-managed" style="padding:6px 12px; font-size:11.5px; background:var(--ws-soft, #f1f5f9); color:var(--ws-muted, #475569); border:1px solid var(--ws-line, #cbd5e1); border-radius:6px; cursor:pointer;">Cancel</button>
                    <button type="submit" id="m360-btn-save-wa-managed" style="padding:6px 16px; font-size:11.5px; font-weight:700; background:var(--ws-button, #075e54); color:#ffffff; border:none; border-radius:6px; cursor:pointer;">🚀 Authorize &amp; Activate Managed WhatsApp</button>
                  </div>
                </form>
              </div>

              <!-- Tab 2: BYOK Form -->
              <div id="m360-wa-panel-byok" style="display:none;">
                <p style="margin:0 0 10px; font-size:11.5px; color:var(--ws-muted, #475569); line-height:1.45;">Enter your Meta Developer credentials to send campaigns directly from your own business WhatsApp account. Keys are encrypted with workspace-isolated secrets before storage.</p>
                <form id="m360-wa-vault-form">
                  <label style="display:block; font-size:11.5px; font-weight:600; color:var(--ws-text, #1e293b); margin-bottom:3px;">System User Access Token (Permanent / Temporary)
                    <input type="password" id="m360-wa-input-token" required placeholder="EAABw..." style="width:100%; box-sizing:border-box; padding:6px 9px; font-size:12px; background:var(--ws-panel, #ffffff); color:var(--ws-text, #1e293b); border:1px solid var(--ws-line, #cbd5e1); border-radius:6px; font-family:monospace;" />
                  </label>
                  <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:8px;">
                    <label style="display:block; font-size:11.5px; font-weight:600; color:var(--ws-text, #1e293b); margin-bottom:3px;">Phone Number ID
                      <input type="text" id="m360-wa-input-phone-id" required placeholder="e.g. 102938475612345" style="width:100%; box-sizing:border-box; padding:6px 9px; font-size:12px; background:var(--ws-panel, #ffffff); color:var(--ws-text, #1e293b); border:1px solid var(--ws-line, #cbd5e1); border-radius:6px; font-family:monospace;" />
                    </label>
                    <label style="display:block; font-size:11.5px; font-weight:600; color:var(--ws-text, #1e293b); margin-bottom:3px;">WhatsApp Business Account ID (WABA)
                      <input type="text" id="m360-wa-input-waba-id" placeholder="e.g. 987654321012345 (optional)" style="width:100%; box-sizing:border-box; padding:6px 9px; font-size:12px; background:var(--ws-panel, #ffffff); color:var(--ws-text, #1e293b); border:1px solid var(--ws-line, #cbd5e1); border-radius:6px; font-family:monospace;" />
                    </label>
                  </div>
                  <div style="display:flex; gap:8px; margin-top:10px; justify-content:flex-end;">
                    <button type="button" id="m360-btn-cancel-wa-config" style="padding:6px 12px; font-size:11.5px; background:var(--ws-soft, #f1f5f9); color:var(--ws-muted, #475569); border:1px solid var(--ws-line, #cbd5e1); border-radius:6px; cursor:pointer;">Cancel</button>
                    <button type="submit" id="m360-btn-save-wa-vault" style="padding:6px 14px; font-size:11.5px; font-weight:700; background:var(--ws-button, #075e54); color:#ffffff; border:none; border-radius:6px; cursor:pointer;">Save &amp; Verify WhatsApp Connection</button>
                  </div>
                </form>
              </div>

              <!-- Step-by-Step 5-Minute Guide -->
              <details style="margin-top:12px; padding:10px 12px; background:var(--ws-soft, #f0fdf4); border:1px solid var(--ws-line, #bbf7d0); border-radius:8px; font-size:11.5px;">
                <summary style="font-weight:700; color:var(--ws-accent, #166534); cursor:pointer;">📘 How to get your WhatsApp Cloud API Key in 5 minutes (New Meta Step-by-Step Guide)</summary>
                <div style="margin:10px 0 0; line-height:1.6; color:var(--ws-text, #14532d);">
                  <div style="margin-bottom:8px;">
                    <strong>Step 1: App Details</strong><br />
                    Log in to <a href="https://developers.facebook.com" target="_blank" rel="noopener noreferrer" style="color:var(--ws-accent, #0f766e); text-decoration:underline;">Meta for Developers</a> and click <strong>My Apps &rarr; Create App</strong>. Enter your business name as the App Name and your contact email.
                  </div>
                  <div style="margin-bottom:8px;">
                    <strong>Step 2: Add Use Cases (Your current screen)</strong><br />
                    In the <strong>Add use cases</strong> list, look for <strong>"Connect with customers through WhatsApp"</strong> (under Featured). Check its checkbox on the far right, then click the blue <strong>Next</strong> button at the bottom right.
                  </div>
                  <div style="margin-bottom:8px;">
                    <strong>Step 3: Connect Business Portfolio</strong><br />
                    Select your Meta Business Portfolio (Business Account) from the dropdown, or enter your business name to create one. Click <strong>Next</strong> &rarr; review requirements &rarr; click <strong>Create App</strong>.
                  </div>
                  <div style="margin-bottom:8px;">
                    <strong>Step 4: Copy API Credentials from API Setup</strong><br />
                    In your App Dashboard, navigate to <strong>WhatsApp &rarr; API Setup</strong> (or under Use Cases, click <em>Connect on WhatsApp &rarr; Quickstart</em>). Under <strong>"Step 1: Send and receive messages"</strong>, copy:
                    <ul style="margin:4px 0 0; padding-left:18px;">
                      <li><strong>Temporary Access Token</strong> (or generate a permanent token below)</li>
                      <li>15-digit <strong>Phone number ID</strong> (e.g. <code>102938475612345</code>)</li>
                      <li><strong>WhatsApp Business Account ID</strong> (WABA ID)</li>
                    </ul>
                  </div>
                  <div>
                    <strong>Step 5: Paste &amp; Verify</strong><br />
                    Paste the <strong>Token</strong> and <strong>Phone Number ID</strong> into this vault above and click <strong>Save &amp; Verify WhatsApp Connection</strong>. Your credentials will be encrypted with AES-256-GCM and verified instantly!
                  </div>
                </div>
              </details>

              <!-- AI Setup Assistant -->
              <div style="margin-top:10px; padding:10px; background:var(--ws-soft, #f8fafc); border:1px solid var(--ws-line, #e2e8f0); border-radius:6px; font-size:11.5px;">
                <div style="display:flex; align-items:center; gap:6px; font-weight:700; color:var(--ws-text, #1e293b); margin-bottom:6px;">
                  <span>🤖 Ask AI WhatsApp Setup Assistant:</span>
                </div>
                <div class="m360-wa-faq-chips" style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:8px;">
                  <button type="button" class="m360-wa-faq-chip" data-faq="screen-help" style="padding:3px 8px; font-size:11px; background:#e0f2fe; border:1px solid #7dd3fc; border-radius:4px; cursor:pointer; color:#0369a1; font-weight:700;">👉 What to click on current screen?</button>
                  <button type="button" class="m360-wa-faq-chip" data-faq="perm-token" style="padding:3px 8px; font-size:11px; background:var(--ws-panel, #e2e8f0); border:1px solid var(--ws-line, #cbd5e1); border-radius:4px; cursor:pointer; color:var(--ws-text, #334155);">Permanent Token?</button>
                  <button type="button" class="m360-wa-faq-chip" data-faq="phone-id" style="padding:3px 8px; font-size:11px; background:var(--ws-panel, #e2e8f0); border:1px solid var(--ws-line, #cbd5e1); border-radius:4px; cursor:pointer; color:var(--ws-text, #334155);">Find Phone ID?</button>
                  <button type="button" class="m360-wa-faq-chip" data-faq="real-num" style="padding:3px 8px; font-size:11px; background:var(--ws-panel, #e2e8f0); border:1px solid var(--ws-line, #cbd5e1); border-radius:4px; cursor:pointer; color:var(--ws-text, #334155);">Add Real Number?</button>
                  <button type="button" class="m360-wa-faq-chip" data-faq="templates" style="padding:3px 8px; font-size:11px; background:var(--ws-panel, #e2e8f0); border:1px solid var(--ws-line, #cbd5e1); border-radius:4px; cursor:pointer; color:var(--ws-text, #334155);">Template Approval?</button>
                </div>
                <div id="m360-wa-ai-answer" style="display:none; padding:8px 10px; background:var(--ws-panel, #ffffff); border:1px solid var(--ws-line, #cbd5e1); border-radius:4px; color:var(--ws-text, #1e293b); line-height:1.45;"></div>
              </div>
            </div>

            <!-- Email Card -->
            <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 12px; background:var(--ws-soft, #f6faf8); border:1px solid var(--ws-line, #cbdcd5); border-radius:8px; font-size:12.5px;">
              <div>
                <span style="font-weight:600; color:var(--ws-accent, #174c40);">✉️ Brevo SMTP Email Relay</span>
                <div id="m360-email-provider-status" style="color:#92400e; font-weight:600; font-size:11.5px; margin-top:2px;">Connection checked when you send</div>
              </div>
              <div style="display:flex; gap:6px;">
                <button type="button" id="m360-btn-open-email-config" style="padding:5px 12px; font-size:11px; font-weight:600; background:#0284c7; color:#ffffff; border:none; border-radius:4px; cursor:pointer;">🔑 Configure Key</button>
                <button type="button" id="m360-btn-verify-brevo" style="padding:5px 10px; font-size:11px; font-weight:600; background:#0f766e; color:#ffffff; border:none; border-radius:4px; cursor:pointer;">Verify</button>
              </div>
            </div>

            <!-- Email Vault Drawer (#m360-email-config-vault) -->
            <div id="m360-email-config-vault" class="m360-provider-vault" style="display:none; padding:14px; background:var(--ws-panel, #ffffff); border:2px solid #0284c7; border-radius:10px; margin-top:8px; color:var(--ws-text, #1e293b);">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                <strong style="font-size:13px; color:#0284c7;">🔐 Brevo SMTP Email Vault</strong>
                <span style="font-size:10.5px; background:var(--ws-soft, #ecfdf5); color:var(--ws-accent, #047857); border:1px solid var(--ws-line, #a7f3d0); padding:2px 8px; border-radius:10px; font-weight:700;">AES-256-GCM ENCRYPTED</span>
              </div>
              <p style="margin:0 0 10px; font-size:11.5px; color:var(--ws-muted, #475569); line-height:1.45;">Configure your Brevo SMTP relay credentials for transactional &amp; campaign email delivery. Credentials are tenant-isolated.</p>
              <form id="m360-email-vault-form">
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                  <label style="display:block; font-size:11.5px; font-weight:600; color:var(--ws-text, #1e293b); margin-bottom:3px;">SMTP Login / Username
                    <input type="text" id="m360-email-input-login" required placeholder="e.g. 76a8b1001@smtp-brevo.com" style="width:100%; box-sizing:border-box; padding:6px 9px; font-size:12px; background:var(--ws-panel, #ffffff); color:var(--ws-text, #1e293b); border:1px solid var(--ws-line, #cbd5e1); border-radius:6px; font-family:monospace;" />
                  </label>
                  <label style="display:block; font-size:11.5px; font-weight:600; color:var(--ws-text, #1e293b); margin-bottom:3px;">Master SMTP Key (Password)
                    <input type="password" id="m360-email-input-key" required placeholder="xsmtpsib-..." style="width:100%; box-sizing:border-box; padding:6px 9px; font-size:12px; background:var(--ws-panel, #ffffff); color:var(--ws-text, #1e293b); border:1px solid var(--ws-line, #cbd5e1); border-radius:6px; font-family:monospace;" />
                  </label>
                </div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:8px;">
                  <label style="display:block; font-size:11.5px; font-weight:600; color:var(--ws-text, #1e293b); margin-bottom:3px;">Verified Sender Email
                    <input type="email" id="m360-email-input-sender" required placeholder="you@company.com" style="width:100%; box-sizing:border-box; padding:6px 9px; font-size:12px; background:var(--ws-panel, #ffffff); color:var(--ws-text, #1e293b); border:1px solid var(--ws-line, #cbd5e1); border-radius:6px;" />
                  </label>
                  <label style="display:block; font-size:11.5px; font-weight:600; color:var(--ws-text, #1e293b); margin-bottom:3px;">Sender Name / Brand
                    <input type="text" id="m360-email-input-name" placeholder="Matrix 360" style="width:100%; box-sizing:border-box; padding:6px 9px; font-size:12px; background:var(--ws-panel, #ffffff); color:var(--ws-text, #1e293b); border:1px solid var(--ws-line, #cbd5e1); border-radius:6px;" />
                  </label>
                </div>
                <div style="display:flex; gap:8px; margin-top:10px; justify-content:flex-end;">
                  <button type="button" id="m360-btn-cancel-email-config" style="padding:6px 12px; font-size:11.5px; background:var(--ws-soft, #f1f5f9); color:var(--ws-muted, #475569); border:1px solid var(--ws-line, #cbd5e1); border-radius:6px; cursor:pointer;">Cancel</button>
                  <button type="submit" id="m360-btn-save-email-vault" style="padding:6px 14px; font-size:11.5px; font-weight:700; background:#0284c7; color:#ffffff; border:none; border-radius:6px; cursor:pointer;">Save &amp; Verify Email Relay</button>
                </div>
              </form>
            </div>

            <!-- Meta Graph API Card -->
            <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 12px; background:var(--ws-soft, #f6faf8); border:1px solid var(--ws-line, #cbdcd5); border-radius:8px; font-size:12.5px;">
              <div>
                <span style="font-weight:600; color:var(--ws-accent, #174c40);">📸 Meta Graph API (Instagram &amp; Facebook)</span>
                <div id="m360-meta-provider-status" style="color:#92400e; font-weight:600; font-size:11.5px; margin-top:2px;">Disconnected (Setup Required)</div>
              </div>
              <div style="display:flex; gap:6px;">
                <button type="button" id="m360-btn-open-meta-config" style="padding:5px 12px; font-size:11px; font-weight:600; background:#2563eb; color:#ffffff; border:none; border-radius:4px; cursor:pointer;">🔑 Configure Key</button>
                <button type="button" id="m360-btn-verify-meta" style="padding:5px 10px; font-size:11px; font-weight:600; background:#0f766e; color:#ffffff; border:none; border-radius:4px; cursor:pointer;">Verify</button>
              </div>
            </div>

            <!-- Meta Vault Drawer (#m360-meta-config-vault) -->
            <div id="m360-meta-config-vault" class="m360-provider-vault" style="display:none; padding:14px; background:var(--ws-panel, #ffffff); border:2px solid #2563eb; border-radius:10px; margin-top:8px; color:var(--ws-text, #1e293b);">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                <strong style="font-size:13px; color:#2563eb;">🔐 Meta (Instagram &amp; Facebook) Vault</strong>
                <span style="font-size:10.5px; background:var(--ws-soft, #ecfdf5); color:var(--ws-accent, #047857); border:1px solid var(--ws-line, #a7f3d0); padding:2px 8px; border-radius:10px; font-weight:700;">AES-256-GCM ENCRYPTED</span>
              </div>
              <p style="margin:0 0 10px; font-size:11.5px; color:var(--ws-muted, #475569); line-height:1.45;">Enter your Facebook Page Access Token and Page ID to publish verified social campaigns and stories directly.</p>
              <form id="m360-meta-vault-form">
                <label style="display:block; font-size:11.5px; font-weight:600; color:var(--ws-text, #1e293b); margin-bottom:3px;">Page Access Token
                  <input type="password" id="m360-meta-input-token" required placeholder="EAAG..." style="width:100%; box-sizing:border-box; padding:6px 9px; font-size:12px; background:var(--ws-panel, #ffffff); color:var(--ws-text, #1e293b); border:1px solid var(--ws-line, #cbd5e1); border-radius:6px; font-family:monospace;" />
                </label>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:8px;">
                  <label style="display:block; font-size:11.5px; font-weight:600; color:var(--ws-text, #1e293b); margin-bottom:3px;">Facebook Page ID
                    <input type="text" id="m360-meta-input-page-id" required placeholder="e.g. 109876543210" style="width:100%; box-sizing:border-box; padding:6px 9px; font-size:12px; background:var(--ws-panel, #ffffff); color:var(--ws-text, #1e293b); border:1px solid var(--ws-line, #cbd5e1); border-radius:6px; font-family:monospace;" />
                  </label>
                  <label style="display:block; font-size:11.5px; font-weight:600; color:var(--ws-text, #1e293b); margin-bottom:3px;">Instagram Business Account ID (optional)
                    <input type="text" id="m360-meta-input-ig-id" placeholder="e.g. 178414000..." style="width:100%; box-sizing:border-box; padding:6px 9px; font-size:12px; background:var(--ws-panel, #ffffff); color:var(--ws-text, #1e293b); border:1px solid var(--ws-line, #cbd5e1); border-radius:6px; font-family:monospace;" />
                  </label>
                </div>
                <div style="display:flex; gap:8px; margin-top:10px; justify-content:flex-end;">
                  <button type="button" id="m360-btn-cancel-meta-config" style="padding:6px 12px; font-size:11.5px; background:var(--ws-soft, #f1f5f9); color:var(--ws-muted, #475569); border:1px solid var(--ws-line, #cbd5e1); border-radius:6px; cursor:pointer;">Cancel</button>
                  <button type="submit" id="m360-btn-save-meta-vault" style="padding:6px 14px; font-size:11.5px; font-weight:700; background:#2563eb; color:#ffffff; border:none; border-radius:6px; cursor:pointer;">Save &amp; Verify Meta Connection</button>
                </div>
              </form>
            </div>

            <!-- LinkedIn Card -->
            <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 12px; background:var(--ws-soft, #f6faf8); border:1px solid var(--ws-line, #cbdcd5); border-radius:8px; font-size:12.5px;">
              <div>
                <span style="font-weight:600; color:var(--ws-accent, #174c40);">LinkedIn Campaigns &amp; Publishing</span>
                <div id="m360-linkedin-provider-status" style="color:#49675d; font-size:11.5px; margin-top:2px;">Connect your profile or company Page</div>
              </div>
              <div style="display:flex; gap:6px;">
                <button type="button" id="m360-btn-open-linkedin-config" style="padding:5px 12px; font-size:11px; font-weight:600; background:#0077b5; color:#ffffff; border:none; border-radius:4px; cursor:pointer;">Open LinkedIn workspace</button>
              </div>
            </div>

            <!-- SMS Card -->
            <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 12px; background:var(--ws-soft, #f6faf8); border:1px solid var(--ws-line, #cbdcd5); border-radius:8px; font-size:12.5px;">
              <div>
                <span style="font-weight:600; color:var(--ws-accent, #174c40);">💬 Twilio SMS Gateway</span>
                <div id="m360-sms-provider-status" style="color:#92400e; font-weight:600; font-size:11.5px; margin-top:2px;">Disconnected (Setup Required)</div>
              </div>
              <div style="display:flex; gap:6px;">
                <button type="button" id="m360-btn-open-sms-config" style="padding:5px 12px; font-size:11px; font-weight:600; background:#e11d48; color:#ffffff; border:none; border-radius:4px; cursor:pointer;">🔑 Configure Key</button>
                <button type="button" id="m360-btn-verify-sms" style="padding:5px 10px; font-size:11px; font-weight:600; background:#0f766e; color:#ffffff; border:none; border-radius:4px; cursor:pointer;">Verify</button>
              </div>
            </div>

            <!-- SMS Vault Drawer (#m360-sms-config-vault) -->
            <div id="m360-sms-config-vault" class="m360-provider-vault" style="display:none; padding:14px; background:var(--ws-panel, #ffffff); border:2px solid #e11d48; border-radius:10px; margin-top:8px; color:var(--ws-text, #1e293b);">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                <strong style="font-size:13px; color:#e11d48;">🔐 Twilio SMS Gateway Vault</strong>
                <span style="font-size:10.5px; background:var(--ws-soft, #ecfdf5); color:var(--ws-accent, #047857); border:1px solid var(--ws-line, #a7f3d0); padding:2px 8px; border-radius:10px; font-weight:700;">AES-256-GCM ENCRYPTED</span>
              </div>
              <p style="margin:0 0 10px; font-size:11.5px; color:var(--ws-muted, #475569); line-height:1.45;">Enter your Twilio Account SID, Auth Token, and Sender Phone Number for SMS broadcasts.</p>
              <form id="m360-sms-vault-form">
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                  <label style="display:block; font-size:11.5px; font-weight:600; color:var(--ws-text, #1e293b); margin-bottom:3px;">Account SID
                    <input type="text" id="m360-sms-input-sid" required placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" style="width:100%; box-sizing:border-box; padding:6px 9px; font-size:12px; background:var(--ws-panel, #ffffff); color:var(--ws-text, #1e293b); border:1px solid var(--ws-line, #cbd5e1); border-radius:6px; font-family:monospace;" />
                  </label>
                  <label style="display:block; font-size:11.5px; font-weight:600; color:var(--ws-text, #1e293b); margin-bottom:3px;">Auth Token
                    <input type="password" id="m360-sms-input-token" required placeholder="••••••••••••••••" style="width:100%; box-sizing:border-box; padding:6px 9px; font-size:12px; background:var(--ws-panel, #ffffff); color:var(--ws-text, #1e293b); border:1px solid var(--ws-line, #cbd5e1); border-radius:6px; font-family:monospace;" />
                  </label>
                </div>
                <label style="display:block; font-size:11.5px; font-weight:600; color:var(--ws-text, #1e293b); margin-top:8px; margin-bottom:3px;">Twilio Sender Phone Number
                  <input type="text" id="m360-sms-input-from" required placeholder="+1234567890" style="width:100%; box-sizing:border-box; padding:6px 9px; font-size:12px; background:var(--ws-panel, #ffffff); color:var(--ws-text, #1e293b); border:1px solid var(--ws-line, #cbd5e1); border-radius:6px; font-family:monospace;" />
                </label>
                <div style="display:flex; gap:8px; margin-top:10px; justify-content:flex-end;">
                  <button type="button" id="m360-btn-cancel-sms-config" style="padding:6px 12px; font-size:11.5px; background:var(--ws-soft, #f1f5f9); color:var(--ws-muted, #475569); border:1px solid var(--ws-line, #cbd5e1); border-radius:6px; cursor:pointer;">Cancel</button>
                  <button type="submit" id="m360-btn-save-sms-vault" style="padding:6px 14px; font-size:11.5px; font-weight:700; background:#e11d48; color:#ffffff; border:none; border-radius:6px; cursor:pointer;">Save &amp; Verify Twilio SMS</button>
                </div>
              </form>
            </div>

          </div>

          <label for="m360-email-test-recipient" style="display:block;margin-top:10px;color:var(--ws-text, #1e293b);">Where should the test email go?</label>

          <input id="m360-email-test-recipient" type="email" autocomplete="email" placeholder="name@example.com" aria-describedby="m360-email-test-help">

          <small id="m360-email-test-help" style="display:block;color:var(--ws-muted, #6b8c82);">Prepare and approve an Email draft first.</small>

          <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin:10px 0;">

            <button type="button" class="primary" id="m360-send-test-email" disabled>Send one test email</button>

            <button type="button" id="m360-quick-email-draft" style="font-size:12px; padding:7px 12px; background:var(--ws-soft, #e0f2fe); color:var(--ws-accent, #0369a1); border:1px solid var(--ws-line, #bae6fd); border-radius:6px; cursor:pointer; font-weight:600;">⚡ Quick AI Draft &amp; Unlock Test</button>

          </div>

          <div style="padding:12px; background:var(--ws-soft, #edf6f2); border:1px solid var(--ws-line, #cbdcd5); border-radius:8px; font-size:12.5px; color:var(--ws-text, #174c40);">

            <strong>Campaign results</strong><p id="m360-results-summary">No verified delivery results yet.</p><p id="m360-delivery-events" role="status"></p><button type="button" id="m360-refresh-results">Check verified events</button>

          </div>

        </div>

      </div>

    `;



    // Mount into mainContainer

    const ref = $('services') || $('m360-content-library') || $('leads');

    if (ref && ref.parentElement === mainContainer) {

      mainContainer.insertBefore(host, ref);

    } else {

      mainContainer.appendChild(host);

    }



    bindEventListeners();



    function syncMarketingVisibility() {

      const isMkt = (window.location.hash || '').toLowerCase().includes('marketing') || (new URLSearchParams(window.location.search).get('page') === 'marketing');

      const el = $('marketing-centre');

      if (el) {

        el.classList.toggle('m360-mp-hidden-section', !isMkt);

        el.setAttribute('data-m360-page-hidden', isMkt ? 'false' : 'true');

      }

    }

    window.addEventListener('hashchange', syncMarketingVisibility);

    window.addEventListener('popstate', syncMarketingVisibility);

    syncMarketingVisibility();



    activeTask = null;

    loadSavedTaskForWorkspace(ws());

  }



  async function api(path, options = {}) {

    const token = auth();

    if (!token) throw Error('Sign in to use Outreach.');

    const response = await fetch(path, { cache: 'no-store', ...options, headers: { Accept: 'application/json', Authorization: 'Bearer ' + token, ...(options.headers || {}) } });

    const data = await response.json().catch(() => ({ error: 'Outreach API returned unreadable data.' }));

    if (!response.ok) throw Object.assign(Error(data.error || data.message || 'Outreach request failed.'), { status: response.status, code: data.code });

    return data;

  }



  function normalizeTask(task) {

    return { ...task, profile_type: task.affinity_strategy?.profile_type || task.profile_type || 'unclassified', strategy: task.affinity_strategy || task.strategy };

  }



  async function loadTask(correlationId) {

    const workspaceId=ws(),handoff=window.M360ActiveCampaign;

    const data = await api('/api/marketing/tasks?' + new URLSearchParams({ workspace_id: workspaceId, correlation_id: correlationId }));

    if(workspaceId!==ws())throw Error('Workspace changed while opening the campaign.');

    if(window.M360ActiveCampaign!==handoff&&window.M360ActiveCampaign?.workspace_id===workspaceId&&window.M360ActiveCampaign.correlation_id!==correlationId)return activeTask||normalizeTask(data.task);

    if (activeTask?.correlation_id !== correlationId) {

      calendarCursor=null;

      $('m360-delivery-events').textContent='';

      if($('m360-draft-editor').open)$('m360-draft-editor').close();

      $('m360-email-test-recipient').value='';

      if($('m360-email-preview').open)$('m360-email-preview').close();

    }

    activeTask = normalizeTask(data.task);

    if (activeTask.strategy && activeTask.channel_draft_versions) renderCompleteTask();

    return activeTask;

  }



  async function loadSavedTaskForWorkspace(workspaceId) {

    if (!workspaceId || !auth()) return setMktStatus('Sign in and choose an authorized workspace.');

    try {

      const activeCtx = window.M360ActiveCampaign;

      if (activeCtx && activeCtx.channel && CHANNELS.includes(activeCtx.channel)) {

        activeChannel = activeCtx.channel;

      }

      if (activeCtx && activeCtx.correlation_id && (!activeCtx.workspace_id || activeCtx.workspace_id===workspaceId)) {

        try {

          await loadTask(activeCtx.correlation_id);

          setMktStatus('Active campaign loaded from Overview.');

          return;

        } catch (_) {}

      }

      const data = await api('/api/marketing/tasks?' + new URLSearchParams({ workspace_id: workspaceId }));

      if(workspaceId!==ws()||window.M360ActiveCampaign!==activeCtx)return;

      if (!data.tasks?.length) return setMktStatus('No Outreach task exists for this workspace yet.');

      await loadTask(data.tasks[0].correlation_id);

      setMktStatus(activeTask.channel_draft_versions ? 'Latest campaign loaded.' : 'Campaign preparation is in progress.');

    } catch (error) { setMktStatus(error.message); }

  }



  async function waitForTask(correlationId) {

    for (let attempt = 0; attempt < 20; attempt++) {

      const task = await loadTask(correlationId);

      setMktStatus('Outreach task: ' + task.status, !['draft_ready', 'failed'].includes(task.status));

      if (['draft_ready', 'failed'].includes(task.status)) return task;

      await new Promise(resolve => setTimeout(resolve, 250));

    }

    throw Error('Outreach task is still running. Use the task list to refresh.');

  }



  function bindDraftEditor(){

    const editor=$('m360-draft-editor');

    let editing=null;

    $('m360-edit-draft').addEventListener('click',()=>{

      const draft=activeTask?.channel_draft_versions?.[activeChannel]?.versions?.at(-1);

      if(!draft)return;

      editing={workspace:ws(),task:activeTask.correlation_id,channel:activeChannel,hash:draft.version_hash};

      $('m360-edit-subject-label').hidden=!draft.subject&&activeChannel!=='Email';

      $('m360-edit-preheader-label').hidden=activeChannel!=='Email';

      $('m360-edit-subject').value=draft.subject||'';

      $('m360-edit-preheader').value=draft.preview_text||'';

      $('m360-edit-body').value=draft.body||'';

      $('m360-draft-edit-status').textContent='Saving creates a version for review.';

      editor.showModal();

    });

    $('m360-cancel-draft-edit').addEventListener('click',()=>editor.close());

    $('m360-draft-edit-form').addEventListener('submit',async event=>{

      event.preventDefault();

      if(!editing||editing.workspace!==ws()||editing.task!==activeTask?.correlation_id)return;

      const context=editing,button=$('m360-save-draft-edit');

      if(button.disabled)return;

      button.disabled=true;

      try{

        const data=await api('/api/marketing/revise',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({

          workspace_id:context.workspace,correlation_id:context.task,channel:context.channel,version_hash:context.hash,

          manual_edit:{body:$('m360-edit-body').value,subject:$('m360-edit-subject').value,preview_text:$('m360-edit-preheader').value}

        })});

        if(context.workspace!==ws()||context.task!==activeTask?.correlation_id)return;

        activeTask.channel_draft_versions=data.channel_draft_versions;

        activeTask.channel_readiness=data.channel_readiness;

        renderChannelTabs();renderActiveChannel();

        if(editing===context&&editor.open)editor.close();

        notify('New draft saved for approval.','success');

      }catch(error){if(editing===context)$('m360-draft-edit-status').textContent=error.message;}

      finally{button.disabled=false;}

    });

  }



  function bindEventListeners() {

    $('marketing-centre').querySelectorAll('[data-outreach-page]').forEach(link=>link.addEventListener('click',event=>{

      if(!window.Matrix360Router?.navigateToPage||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;

      event.preventDefault();window.Matrix360Router.navigateToPage(link.dataset.outreachPage);

    }));

    bindDraftEditor();

    $('m360-refresh-results').addEventListener('click',loadVerifiedResults);

    $('m360-email-test-recipient').addEventListener('input',renderTestReadiness);

    $('m360-audience-filter').addEventListener('change',()=>renderLeadsTable());

    $('m360-email-preview').addEventListener('close',()=>$('m360-email-preview-content').replaceChildren());

    document.addEventListener('m360:outreach-brief',event=>{

      if(event.detail?.workspace!==ws()||!auth())return;

      activeConversation=null;renderConversation();

      if(CHANNELS.includes(event.detail.channel))activeChannel=event.detail.channel;

      const input=$('m360-conversation-input');

      input.value=String(event.detail.prompt||'').slice(0,input.maxLength);

      input.focus({preventScroll:true});

      setMktStatus('Overview brief loaded. Review it before preparing campaign drafts.');

    });

    document.addEventListener('m360:campaign-prepared',event=>{

      if(event.detail?.workspace_id!==ws())return;

      activeChannel='Email';

      loadTask(event.detail.correlation_id).then(()=>setMktStatus('Email draft ready for review. Nothing sent.')).catch(error=>setMktStatus(error.message));

    });

    // Automatic workspace synchronization

    document.addEventListener('m360:crm-loaded', event => {

      if (event.detail?.workspace !== ws()) return;

      if ($('m360-active-client-label')) $('m360-active-client-label').textContent = getActiveClientInfo().clientName;

      if (!activeTask) loadSavedTaskForWorkspace(ws());

    });

    $('workspace')?.addEventListener('change', () => {

      const info = getActiveClientInfo();

      if ($('m360-active-client-label')) $('m360-active-client-label').textContent = info.clientName;

      activeTask=null;activeConversation=null;activeChannel='Email';

      $('m360-email-test-recipient').value='';

      $('m360-email-provider-status').textContent='Connection checked when you send';

      if($('m360-email-preview').open)$('m360-email-preview').close();

      if($('m360-draft-editor').open)$('m360-draft-editor').close();

      $('m360-delivery-events').textContent='';

      $('m360-conversation-input').value='';renderConversation();renderTestReadiness();

      for(const id of ['m360-campaign-summary','m360-results-summary','m360-channel-tabs','m360-channel-custom-view','m360-gate-container','m360-leads-tbody','m360-leads-summary-text','m360-diff-viewer','m360-strategy-content'])$(id)?.replaceChildren();

      $('m360-channels-section').hidden=true;

      loadSavedTaskForWorkspace(info.wsId);

    });



    // Inter-Agent Action Buttons

    $('btn-bus-leads')?.addEventListener('click', () => coordinateEngines('audience'));

    $('btn-bus-content')?.addEventListener('click', () => coordinateEngines('content'));

    $('btn-bus-overview')?.addEventListener('click', () => coordinateEngines('overview'));

    $('btn-bus-full-sync')?.addEventListener('click', () => coordinateEngines('full'));

    $('m360-calendar-prev')?.addEventListener('click', () => { const date = calendarCursor || new Date(); calendarCursor = new Date(date.getFullYear(), date.getMonth() - 1, 1); renderCalendar(); });

    $('m360-calendar-next')?.addEventListener('click', () => { const date = calendarCursor || new Date(); calendarCursor = new Date(date.getFullYear(), date.getMonth() + 1, 1); renderCalendar(); });

    $('m360-calendar-new')?.addEventListener('click', () => { calendarSelectedEventId = ''; renderCalendarEditor(); });

    $('m360-calendar-form')?.addEventListener('submit', saveCalendarEvent);

    $('m360-calendar-remove')?.addEventListener('click', removeCalendarEvent);

    $('m360-journey-form')?.addEventListener('submit', saveJourneyRule);

    $('m360-conversation-form')?.addEventListener('submit', submitMarketingConversation);

    $('m360-conversation-new')?.addEventListener('click', () => { activeConversation = null; $('m360-conversation-history').replaceChildren(); $('m360-conversation-input').value = ''; setMktStatus('New Outreach conversation ready.'); });

    document.querySelectorAll('[data-campaign-suggestion]').forEach(button => button.addEventListener('click', () => { $('m360-conversation-input').value = button.dataset.campaignSuggestion; $('m360-conversation-input').focus(); }));

    document.querySelectorAll('[data-revision-suggestion]').forEach(button => button.addEventListener('click', () => { $('m360-revision-input').value = button.dataset.revisionSuggestion; $('m360-revision-input').focus(); }));

    $('m360-send-test-email')?.addEventListener('click', sendControlledTestEmail);

    $('m360-btn-verify-brevo')?.addEventListener('click', async () => {

      const btn = $('m360-btn-verify-brevo');

      const statusEl = $('m360-email-provider-status');

      if (btn) btn.disabled = true;

      if (statusEl) {

        statusEl.textContent = 'Connecting to Brevo SMTP (Port 587)...';

        statusEl.style.color = '#0284c7';

      }

      try {

        const res = await api('/api/marketing/providers/verify', {

          method: 'POST',

          headers: { 'Content-Type': 'application/json' },

          body: JSON.stringify({ workspace_id: ws(), provider: 'email' })

        });

        if (res && res.verified) {

          if (statusEl) {

            statusEl.textContent = '✓ Brevo SMTP Connected & Verified (Port 587)';

            statusEl.style.color = '#15803d';

          }

          notify('Brevo SMTP connection verified successfully!', 'success');

        } else {

          if (statusEl) {

            statusEl.textContent = (res && res.error) || 'Brevo verification failed';

            statusEl.style.color = '#b91c1c';

          }

          notify((res && res.error) || 'Brevo SMTP check failed', 'error');

        }

      } catch (err) {

        if (statusEl) {

          statusEl.textContent = err.message || 'SMTP verification error';

          statusEl.style.color = '#b91c1c';

        }

        notify(err.message || 'Brevo SMTP credentials missing or invalid in .env.local', 'error');

      } finally {

        if (btn) btn.disabled = false;

      }

    });



    $('m360-quick-email-draft')?.addEventListener('click', async () => {

      const btn = $('m360-quick-email-draft');

      btn.disabled = true;

      btn.textContent = 'Preparing Draft...';

      try {

        setMktStatus('Generating and approving quick email draft...', true);

        const info = getActiveClientInfo();

        const brief = `Prepare an introductory business offer email highlighting key services and value proposition for ${info.clientName || 'our business'}.`;

        const task = await prepareCampaign(brief, 'Email');

        if (task && task.correlation_id) {

          activeChannel = 'Email';

          await loadTask(task.correlation_id);

          const draft = activeTask?.channel_draft_versions?.Email?.versions?.at(-1);

          if (draft && draft.status !== 'approved') {

            await approveChannel('Email', draft.version_hash);

          }

          notify('Email draft prepared and approved. Ready to send test email!', 'success');

        }

      } catch (err) {

        notify(err.message || 'Failed to prepare quick draft', 'error');

      } finally {

        btn.disabled = false;

        btn.textContent = '⚡ Quick AI Draft & Unlock Test';

        renderTestReadiness();

      }

    });



    // Surgical Revision

    $('btn-apply-revision')?.addEventListener('click', async () => {

      const revText = $('m360-revision-input')?.value?.trim();

      if (!revText || !activeTask?.channel_draft_versions) return;



      appendTerminalLog('Revision AI', 'Surgically revising channel copies based on: ' + revText);



      try {

        setMktStatus('Outreach AI is grounding the rewrite in Company Details…', true);

        const data = await api('/api/marketing/revise', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspace_id: ws(), correlation_id: activeTask.correlation_id, channel: activeChannel, revision_prompt: revText }) });

        activeTask.channel_draft_versions = data.channel_draft_versions;

        activeTask.channel_readiness = data.channel_readiness;

        activeTask.ai_telemetry = data.ai_telemetry;

        $('m360-revision-input').value = '';

        renderActiveChannel(); renderChannelTabs();

        appendTerminalLog('Revision', 'Updated: ' + data.targeted_channels.join(', ') + '; preserved: ' + data.preserved_channels.join(', ') + '.');

        notify('Only ' + data.targeted_channels.join(', ') + ' received new versions.', 'success');

      } catch (error) { notify(error.message, 'error'); }

      finally { setMktStatus('Ready'); }

    });



    // Approve Channel Draft

    $('btn-approve-channel')?.addEventListener('click', async () => {

      if (!activeTask?.channel_draft_versions?.[activeChannel]) return;

      const entry = activeTask.channel_draft_versions[activeChannel];

      const cur = entry.versions[entry.versions.length - 1];

      try {

        await api('/api/marketing/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspace_id: ws(), correlation_id: activeTask.correlation_id, channel: activeChannel, version_hash: cur.version_hash }) });

        await loadTask(activeTask.correlation_id);

        appendTerminalLog('Editorial Gate', 'Backend approved version ' + cur.version + ' for ' + activeChannel + '.');

        notify(activeChannel + ' draft approved for review workflow.', 'success');

      } catch (error) { notify(error.message, 'error'); }

    });



    // Launch Channel (Requires all 3 Gates)

    $('btn-launch-channel')?.addEventListener('click', async () => {

      if(activeChannel==='LinkedIn'){await window.Matrix360LinkedIn?.open({text:activeTask?.channel_draft_versions?.LinkedIn?.versions?.at(-1)?.text_body||''});return;}

      const g = activeTask?.channel_readiness?.[activeChannel]?.gates;

      if (!g?.gate1_draft?.passed) {

        notify('Gate 1 Blocked: Editorial approval required before launch.', 'error');

        return;

      }

      if (!g?.gate2_audience?.passed || g.gate2_audience.eligible_count <= 0) {

        notify('Gate 2 Blocked: No eligible contacts with verified consent found.', 'error');

        return;

      }

      if (activeChannel!=='Email'&&!g?.gate3_provider?.passed) {

        alert('[GATE 3 BLOCKED - PROVIDER CONNECTION REQUIRED]\n\n' +

          'No authenticated ' + (g?.gate3_provider?.provider_name || 'API') + ' connection is configured.\n\n' +

          'To dispatch real messages, configure the authorized credentials in your local .env.local:\n' +

          (activeChannel === 'WhatsApp' ? '- WHATSAPP_API_TOKEN\n- WHATSAPP_PHONE_NUMBER_ID\n' :

           activeChannel === 'Email' ? '- BREVO_SMTP_HOST\n- BREVO_SMTP_PORT\n- BREVO_SMTP_LOGIN\n- BREVO_SMTP_KEY\n- BREVO_SENDER_EMAIL\n' :

           '- META_ACCESS_TOKEN\n') +

          '\nLive outbound execution is blocked until genuine credentials are provided.');

        return;

      }



      const channel=activeChannel,workspaceId=ws(),taskId=activeTask.correlation_id;

      const draft=activeTask.channel_draft_versions[channel].versions.at(-1);

      if(!confirm('Launch '+channel+' version '+draft.version+' to '+g.gate2_audience.eligible_count+' eligible contact(s)?'))return;

      $('btn-launch-channel').disabled=true;



      setMktStatus('Launching ' + activeChannel + ' through live provider gateway…', true);

      try {

        const res = await fetch('/api/marketing/execute', {

          method: 'POST',

          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (auth() || '') },

          body: JSON.stringify({

            workspace_id: ws(),

            correlation_id: activeTask.correlation_id,

            channel: activeChannel,

            mode: 'live',

            operator_approved: true,

            approval_phrase: activeChannel === 'Email' ? 'SEND_APPROVED_EMAIL_CAMPAIGN' : (activeChannel === 'WhatsApp' ? 'SEND_APPROVED_WHATSAPP_CAMPAIGN' : `SEND_APPROVED_${activeChannel.toUpperCase()}_CAMPAIGN`),

            version_hash: draft.version_hash

          })

        });

        const data = await res.json();

        if (data.status === 'ok' || data.status === 'provider_accepted') {

          const execution = data.executions?.[0] || {};

          const dest = (data.recipient_count || execution.recipient_count || 0) + ' recipient(s)';

          appendTerminalLog('Execution Dispatch', activeChannel + ' accepted by ' + (execution.provider || 'verified provider') + ' for ' + dest + '.');

          notify(channel + ' was accepted by the verified provider. Delivery is pending.', 'success');

          if(workspaceId===ws()&&activeTask?.correlation_id===taskId)await loadTask(taskId);

        } else {

          notify('Dispatch blocked: ' + (data.error || 'Provider execution failed'), 'error');

        }

      } catch (err) {

        notify('Execution error: ' + err.message, 'error');

      } finally {

        setMktStatus('Ready');

        if(activeTask?.channel_draft_versions)renderActiveChannel();

      }

    });



    // Test on My Device (WhatsApp Click-to-Chat or Email test preview)

    $('btn-test-preview')?.addEventListener('click', async () => {

      if(activeChannel==='Email'){

        const view=$('m360-channel-custom-view');

        $('m360-email-preview-content').replaceChildren(view.firstElementChild.cloneNode(true));

        $('m360-email-preview').showModal();

        return;

      }

      setMktStatus('Preparing WhatsApp preview…', true);

      try {

        const res = await fetch('/api/marketing/execute', {

          method: 'POST',

          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (auth() || '') },

          body: JSON.stringify({

            workspace_id: ws(),

            correlation_id: activeTask.correlation_id,

            channel: activeChannel,

            mode: 'test_preview'

          })

        });

        const data = await res.json();

        if ((data.status === 'ok' || data.status === 'test_preview_ready') && data.test_url) {

          appendTerminalLog('Test Preview', 'WhatsApp Click-to-Chat URL ready: ' + data.test_url);

          notify('Test URL ready! Opening WhatsApp Web/App...', 'success');

          window.open(data.test_url, '_blank');

        } else if (data.status === 'ok' || data.status === 'test_preview_ready') {

          appendTerminalLog('Test Preview', data.message || 'Test preview generated.');

          notify(data.message || 'Test preview generated.', 'success');

        } else {

          notify('Test preview failed: ' + (data.error || 'Blocked'), 'error');

        }

      } catch (err) {

        notify('Preview error: ' + err.message, 'error');

      } finally {

        setMktStatus('Ready');

      }

    });



    // Preview CTWA Bridge Email

    $('btn-preview-ctwa-bridge')?.addEventListener('click', () => {

      const b = activeTask.email_to_ctwa_bridge;

      if (!b || b.status === 'blocked_verified_sender_required') return notify('CTWA bridge is blocked until a verified tenant WhatsApp sender and email consent evidence exist.', 'error');

      alert('[EMAIL-TO-CTWA BRIDGE DRAFT]\n\nSubject: ' + b.subject + '\n\n' + b.body + '\n\nTarget Contacts: ' + b.target_contacts_count + '\nCompliance: Meta WhatsApp Opt-In Policy (Voluntary Tap Required).');

    });



    // Budget Sliders

    $('m360-slider-budget')?.addEventListener('input', (e) => {

      const val = +e.target.value;

      $('m360-val-budget').textContent = 'INR ' + val.toLocaleString('en-IN');

      recalcBudget(val, +$('m360-slider-duration').value);

    });



    $('m360-slider-duration')?.addEventListener('input', (e) => {

      const val = +e.target.value;

      $('m360-val-duration').textContent = val + ' Days';

      recalcBudget(+$('m360-slider-budget').value, val);

    });



    // Lead Search Filter

    $('m360-lead-search')?.addEventListener('input', (e) => {

      const q = e.target.value.toLowerCase().trim();

      renderLeadsTable(q);

    });

    // Persona Mode Switcher Handlers
    $('m360-btn-persona-b2b')?.addEventListener('click', async () => {
      if (!activeTask?.correlation_id) { notify('Please start or load a campaign first.', 'error'); return; }
      try {
        await api('/api/marketing/switch-persona', { method: 'POST', body: JSON.stringify({ workspace_id: ws(), correlation_id: activeTask.correlation_id, persona_mode: 'b2b_industrial' }) });
        await loadTask(activeTask.correlation_id);
        notify('Switched to B2B Industrial Enterprise targeting.', 'success');
      } catch (err) { notify(err.message, 'error'); }
    });

    $('m360-btn-persona-b2c')?.addEventListener('click', async () => {
      if (!activeTask?.correlation_id) { notify('Please start or load a campaign first.', 'error'); return; }
      try {
        await api('/api/marketing/switch-persona', { method: 'POST', body: JSON.stringify({ workspace_id: ws(), correlation_id: activeTask.correlation_id, persona_mode: 'b2c_affinity' }) });
        await loadTask(activeTask.correlation_id);
        notify('Switched to B2C Residential & Hometown Affinity targeting.', 'success');
      } catch (err) { notify(err.message, 'error'); }
    });

    // WhatsApp Key Vault & Verification Handlers
    $('m360-btn-open-wa-config')?.addEventListener('click', () => {
      const vault = $('m360-wa-config-vault');
      if (vault) vault.style.display = vault.style.display === 'none' ? 'block' : 'none';
    });

    $('m360-btn-cancel-wa-config')?.addEventListener('click', () => {
      const vault = $('m360-wa-config-vault');
      if (vault) vault.style.display = 'none';
    });

    $('m360-btn-cancel-wa-managed')?.addEventListener('click', () => {
      const vault = $('m360-wa-config-vault');
      if (vault) vault.style.display = 'none';
    });

    $('m360-wa-tab-managed')?.addEventListener('click', () => {
      const panelManaged = $('m360-wa-panel-managed');
      const panelByok = $('m360-wa-panel-byok');
      const tabManaged = $('m360-wa-tab-managed');
      const tabByok = $('m360-wa-tab-byok');
      if (panelManaged) panelManaged.style.display = 'block';
      if (panelByok) panelByok.style.display = 'none';
      if (tabManaged) { tabManaged.style.background = 'var(--ws-button, #075e54)'; tabManaged.style.color = '#ffffff'; }
      if (tabByok) { tabByok.style.background = 'var(--ws-soft, #f1f5f9)'; tabByok.style.color = 'var(--ws-muted, #475569)'; }
    });

    $('m360-wa-tab-byok')?.addEventListener('click', () => {
      const panelManaged = $('m360-wa-panel-managed');
      const panelByok = $('m360-wa-panel-byok');
      const tabManaged = $('m360-wa-tab-managed');
      const tabByok = $('m360-wa-tab-byok');
      if (panelManaged) panelManaged.style.display = 'none';
      if (panelByok) panelByok.style.display = 'block';
      if (tabByok) { tabByok.style.background = 'var(--ws-button, #075e54)'; tabByok.style.color = '#ffffff'; }
      if (tabManaged) { tabManaged.style.background = 'var(--ws-soft, #f1f5f9)'; tabManaged.style.color = 'var(--ws-muted, #475569)'; }
    });

    $('m360-wa-managed-form')?.addEventListener('submit', async event => {
      event.preventDefault();
      const bizName = $('m360-wa-managed-biz-name')?.value.trim();
      const replyPhone = $('m360-wa-managed-reply-phone')?.value.trim();
      const consentChecked = $('m360-wa-managed-consent-check')?.checked;
      if (!replyPhone || !consentChecked) {
        notify('Please enter your WhatsApp reply phone number and agree to campaign authorization.', 'error');
        return;
      }
      const saveBtn = $('m360-btn-save-wa-managed');
      if (saveBtn) saveBtn.disabled = true;
      try {
        const res = await api('/api/marketing/providers/configure', {
          method: 'POST',
          body: JSON.stringify({
            workspace_id: ws(),
            provider: 'whatsapp',
            mode: 'managed_concierge',
            business_name: bizName,
            reply_phone: replyPhone,
            consent_agreed: true
          })
        });
        const statusEl = $('m360-wa-provider-status');
        if (statusEl) {
          statusEl.textContent = '✓ Managed Concierge Active (Replies → ' + replyPhone + ')';
          statusEl.style.color = '#15803d';
        }
        notify('Managed WhatsApp Campaign Activated! 48-Hour SLA confirmed.', 'success');
        if (activeTask?.correlation_id) await loadTask(activeTask.correlation_id);
        const vault = $('m360-wa-config-vault');
        if (vault) vault.style.display = 'none';
      } catch (err) {
        notify(err.message || 'Failed to activate Managed WhatsApp.', 'error');
      } finally {
        if (saveBtn) saveBtn.disabled = false;
      }
    });

    $('m360-wa-vault-form')?.addEventListener('submit', async event => {
      event.preventDefault();
      const token = $('m360-wa-input-token')?.value.trim();
      const phoneNumberId = $('m360-wa-input-phone-id')?.value.trim();
      const wabaId = $('m360-wa-input-waba-id')?.value.trim();
      if (!token || !phoneNumberId) { notify('Access Token and Phone Number ID are required.', 'error'); return; }
      const saveBtn = $('m360-btn-save-wa-vault');
      if (saveBtn) saveBtn.disabled = true;
      try {
        const res = await api('/api/marketing/providers/configure', {
          method: 'POST',
          body: JSON.stringify({ workspace_id: ws(), provider: 'whatsapp', token, phone_number_id: phoneNumberId, waba_id: wabaId })
        });
        const statusEl = $('m360-wa-provider-status');
        if (statusEl) {
          statusEl.textContent = '✓ Meta WhatsApp Connected (' + (res?.verification?.display_phone_number || phoneNumberId) + ')';
          statusEl.style.color = '#15803d';
        }
        notify('Meta WhatsApp Cloud API configured and encrypted successfully!', 'success');
        if (activeTask?.correlation_id) await loadTask(activeTask.correlation_id);
        const vault = $('m360-wa-config-vault');
        if (vault) vault.style.display = 'none';
      } catch (err) {
        notify(err.message || 'Failed to configure WhatsApp credentials.', 'error');
      } finally {
        if (saveBtn) saveBtn.disabled = false;
      }
    });

    $('m360-btn-verify-wa')?.addEventListener('click', async () => {
      const btn = $('m360-btn-verify-wa');
      const statusEl = $('m360-wa-provider-status');
      if (btn) btn.disabled = true;
      if (statusEl) { statusEl.textContent = 'Verifying WhatsApp Graph API...'; statusEl.style.color = '#0284c7'; }
      try {
        const res = await api('/api/marketing/providers/verify', {
          method: 'POST',
          body: JSON.stringify({ workspace_id: ws(), provider: 'whatsapp' })
        });
        if (res && res.verified) {
          if (statusEl) {
            statusEl.textContent = '✓ Meta WhatsApp Verified (' + (res.display_phone_number || res.verified_name || 'Active') + ')';
            statusEl.style.color = '#15803d';
          }
          notify('Meta WhatsApp Cloud API connection verified!', 'success');
          if (activeTask?.correlation_id) await loadTask(activeTask.correlation_id);
        } else {
          if (statusEl) { statusEl.textContent = res?.message || res?.error || 'Verification failed'; statusEl.style.color = '#b91c1c'; }
          notify(res?.message || res?.error || 'WhatsApp verification failed. Configure key first.', 'error');
        }
      } catch (err) {
        if (statusEl) { statusEl.textContent = err.message || 'Verification error'; statusEl.style.color = '#b91c1c'; }
        notify(err.message || 'WhatsApp verification error', 'error');
      } finally {
        if (btn) btn.disabled = false;
      }
    });

    // WhatsApp AI Setup Assistant FAQ chips
    const WA_FAQS = {
      'screen-help': '<strong>Right Now on Your Screen (Use Cases):</strong><br />1. Scroll down to the 6th option in Featured: <strong>"Connect with customers through WhatsApp"</strong>.<br />2. Click the empty checkbox on the far right of that card to select it.<br />3. The <strong>Next</strong> button at the bottom right will turn bright blue. Click <strong>Next</strong> to proceed to Step 3 (Business Portfolio)!',
      'perm-token': '<strong>Permanent Token (Never Expires):</strong> In Meta Business Manager &rarr; Business Settings &rarr; Users &rarr; System Users. Add a System User (role: Admin), click "Generate New Token", select your App, set expiration to "Never", and grant <code>whatsapp_business_messaging</code> and <code>whatsapp_business_management</code>.',
      'phone-id': '<strong>Find Phone ID:</strong> In developers.facebook.com &rarr; My Apps &rarr; WhatsApp &rarr; API Setup. Under "Step 1: Select phone numbers", the 15-digit number labeled "Phone number ID" is what you copy here (not your actual phone number).',
      'real-num': '<strong>Add Real Phone:</strong> In Meta WhatsApp Manager &rarr; Account Tools &rarr; Phone Numbers. Click "Add Phone Number", follow the SMS/Voice verification code step, and ensure this number is NOT currently registered on standard WhatsApp consumer app.',
      'templates': '<strong>Template Approval:</strong> Meta requires pre-approved templates for business-initiated conversations. Create templates under WhatsApp Manager &rarr; Message Templates. Approvals take from 2 minutes to 2 hours via Meta AI automated review.'
    };
    document.querySelectorAll('.m360-wa-faq-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const faqKey = chip.dataset.faq;
        const answerEl = $('m360-wa-ai-answer');
        if (answerEl && WA_FAQS[faqKey]) {
          answerEl.innerHTML = WA_FAQS[faqKey];
          answerEl.style.display = 'block';
        }
      });
    });

    // Email Key Vault Handlers
    $('m360-btn-open-email-config')?.addEventListener('click', () => {
      const vault = $('m360-email-config-vault');
      if (vault) vault.style.display = vault.style.display === 'none' ? 'block' : 'none';
    });
    $('m360-btn-cancel-email-config')?.addEventListener('click', () => {
      const vault = $('m360-email-config-vault');
      if (vault) vault.style.display = 'none';
    });
    $('m360-email-vault-form')?.addEventListener('submit', async event => {
      event.preventDefault();
      const login = $('m360-email-input-login')?.value.trim();
      const key = $('m360-email-input-key')?.value.trim();
      const sender = $('m360-email-input-sender')?.value.trim();
      const name = $('m360-email-input-name')?.value.trim() || 'Matrix 360';
      if (!login || !key || !sender) { notify('Login, SMTP Key, and Sender Email are required.', 'error'); return; }
      try {
        const res = await api('/api/marketing/providers/configure', {
          method: 'POST',
          body: JSON.stringify({ workspace_id: ws(), provider: 'email', smtp_login: login, smtp_key: key, sender_email: sender, sender_name: name })
        });
        const statusEl = $('m360-email-provider-status');
        if (statusEl) {
          statusEl.textContent = '✓ Brevo SMTP Connected & Verified (' + sender + ')';
          statusEl.style.color = '#15803d';
        }
        notify('Brevo SMTP credentials encrypted and verified successfully!', 'success');
        const vault = $('m360-email-config-vault');
        if (vault) vault.style.display = 'none';
      } catch (err) {
        notify(err.message || 'Failed to configure Brevo SMTP.', 'error');
      }
    });

    // Meta Key Vault Handlers
    $('m360-btn-open-meta-config')?.addEventListener('click', () => {
      const vault = $('m360-meta-config-vault');
      if (vault) vault.style.display = vault.style.display === 'none' ? 'block' : 'none';
    });
    $('m360-btn-cancel-meta-config')?.addEventListener('click', () => {
      const vault = $('m360-meta-config-vault');
      if (vault) vault.style.display = 'none';
    });
    $('m360-meta-vault-form')?.addEventListener('submit', async event => {
      event.preventDefault();
      const token = $('m360-meta-input-token')?.value.trim();
      const pageId = $('m360-meta-input-page-id')?.value.trim();
      const igId = $('m360-meta-input-ig-id')?.value.trim();
      if (!token || !pageId) { notify('Page Access Token and Page ID are required.', 'error'); return; }
      try {
        const res = await api('/api/marketing/providers/configure', {
          method: 'POST',
          body: JSON.stringify({ workspace_id: ws(), provider: 'meta', token, page_id: pageId, ig_user_id: igId })
        });
        const statusEl = $('m360-meta-provider-status');
        if (statusEl) {
          statusEl.textContent = '✓ Meta Graph Connected (' + (res?.page_name || pageId) + ')';
          statusEl.style.color = '#15803d';
        }
        notify('Meta credentials encrypted and verified successfully!', 'success');
        const vault = $('m360-meta-config-vault');
        if (vault) vault.style.display = 'none';
      } catch (err) {
        notify(err.message || 'Failed to configure Meta credentials.', 'error');
      }
    });
    $('m360-btn-verify-meta')?.addEventListener('click', async () => {
      const btn = $('m360-btn-verify-meta');
      const statusEl = $('m360-meta-provider-status');
      if (btn) btn.disabled = true;
      if (statusEl) { statusEl.textContent = 'Verifying Meta Graph API...'; statusEl.style.color = '#0284c7'; }
      try {
        const res = await api('/api/marketing/providers/verify', {
          method: 'POST',
          body: JSON.stringify({ workspace_id: ws(), provider: 'meta' })
        });
        if (res && res.verified) {
          if (statusEl) {
            statusEl.textContent = '✓ Meta Graph Verified (' + (res.page_name || res.page_id || 'Active') + ')';
            statusEl.style.color = '#15803d';
          }
          notify('Meta connection verified!', 'success');
        } else {
          if (statusEl) { statusEl.textContent = res?.message || res?.error || 'Verification failed'; statusEl.style.color = '#b91c1c'; }
          notify(res?.message || 'Meta verification failed. Configure key first.', 'error');
        }
      } catch (err) {
        if (statusEl) { statusEl.textContent = err.message; statusEl.style.color = '#b91c1c'; }
        notify(err.message || 'Meta verification error', 'error');
      } finally {
        if (btn) btn.disabled = false;
      }
    });

    // LinkedIn uses the workspace's individual OAuth grants.
    $('m360-btn-open-linkedin-config')?.addEventListener('click', () => {
      window.Matrix360LinkedIn?.open();
    });

    // SMS Key Vault Handlers
    $('m360-btn-open-sms-config')?.addEventListener('click', () => {
      const vault = $('m360-sms-config-vault');
      if (vault) vault.style.display = vault.style.display === 'none' ? 'block' : 'none';
    });
    $('m360-btn-cancel-sms-config')?.addEventListener('click', () => {
      const vault = $('m360-sms-config-vault');
      if (vault) vault.style.display = 'none';
    });
    $('m360-sms-vault-form')?.addEventListener('submit', async event => {
      event.preventDefault();
      const sid = $('m360-sms-input-sid')?.value.trim();
      const token = $('m360-sms-input-token')?.value.trim();
      const from = $('m360-sms-input-from')?.value.trim();
      if (!sid || !token || !from) { notify('Account SID, Auth Token, and From Number are required.', 'error'); return; }
      try {
        const res = await api('/api/marketing/providers/configure', {
          method: 'POST',
          body: JSON.stringify({ workspace_id: ws(), provider: 'sms', account_sid: sid, auth_token: token, from_number: from })
        });
        const statusEl = $('m360-sms-provider-status');
        if (statusEl) {
          statusEl.textContent = '✓ Twilio SMS Connected (' + from + ')';
          statusEl.style.color = '#15803d';
        }
        notify('Twilio SMS credentials encrypted and verified successfully!', 'success');
        const vault = $('m360-sms-config-vault');
        if (vault) vault.style.display = 'none';
      } catch (err) {
        notify(err.message || 'Failed to configure Twilio SMS.', 'error');
      }
    });
    $('m360-btn-verify-sms')?.addEventListener('click', async () => {
      const btn = $('m360-btn-verify-sms');
      const statusEl = $('m360-sms-provider-status');
      if (btn) btn.disabled = true;
      if (statusEl) { statusEl.textContent = 'Verifying Twilio API...'; statusEl.style.color = '#0284c7'; }
      try {
        const res = await api('/api/marketing/providers/verify', {
          method: 'POST',
          body: JSON.stringify({ workspace_id: ws(), provider: 'sms' })
        });
        if (res && res.verified) {
          if (statusEl) {
            statusEl.textContent = '✓ Twilio SMS Verified';
            statusEl.style.color = '#15803d';
          }
          notify('Twilio SMS connection verified!', 'success');
        } else {
          if (statusEl) { statusEl.textContent = res?.message || res?.error || 'Verification failed'; statusEl.style.color = '#b91c1c'; }
          notify(res?.message || 'Twilio verification failed. Configure key first.', 'error');
        }
      } catch (err) {
        if (statusEl) { statusEl.textContent = err.message; statusEl.style.color = '#b91c1c'; }
        notify(err.message || 'Twilio verification error', 'error');
      } finally {
        if (btn) btn.disabled = false;
      }
    });

    // Initial Providers Status Refresh
    const loadProviderStatuses = async () => {
      try {
        const res = await api('/api/marketing/providers/status?workspace_id=' + encodeURIComponent(ws()));
        if (res && res.providers) {
          if (res.providers.whatsapp?.configured) {
            const el = $('m360-wa-provider-status');
            const isManaged = res.providers.whatsapp.mode === 'managed_concierge' || res.providers.whatsapp.managed;
            const label = isManaged
              ? '✓ Managed Concierge Active (Replies → ' + (res.providers.whatsapp.reply_phone || res.providers.whatsapp.display_phone_number || 'Your Phone') + ')'
              : '✓ Meta WhatsApp Connected (' + (res.providers.whatsapp.display_phone_number || res.providers.whatsapp.phone_number_id || 'Active') + ')';
            if (el) { el.textContent = label; el.style.color = '#15803d'; }
          }
          if (res.providers.email?.configured) {
            const el = $('m360-email-provider-status');
            if (el) { el.textContent = '✓ Brevo SMTP Configured (' + (res.providers.email.sender_email || 'Active') + ')'; el.style.color = '#15803d'; }
          }
          if (res.providers.meta?.configured) {
            const el = $('m360-meta-provider-status');
            if (el) { el.textContent = '✓ Meta Graph Configured (' + (res.providers.meta.page_id || 'Active') + ')'; el.style.color = '#15803d'; }
          }
          if (res.providers.sms?.configured) {
            const el = $('m360-sms-provider-status');
            if (el) { el.textContent = '✓ Twilio SMS Configured (' + (res.providers.sms.account_sid || 'Active') + ')'; el.style.color = '#15803d'; }
          }
        }
      } catch (_) {}
    };
    loadProviderStatuses();

    // Team Supervisor Review Handlers
    $('m360-btn-team-agree')?.addEventListener('click', async () => {
      if (!activeTask?.correlation_id) return;
      try {
        await api('/api/marketing/agent-team', {
          method: 'POST',
          body: JSON.stringify({ workspace_id: ws(), correlation_id: activeTask.correlation_id, operation: 'review', review: 'agreed', feedback: 'Overview Boss approved deliverables.' })
        });
        await loadTask(activeTask.correlation_id);
        notify('Overview Boss: Deliverables approved and agreed!', 'success');
      } catch (err) { notify(err.message, 'error'); }
    });

    $('m360-btn-team-disagree')?.addEventListener('click', async () => {
      if (!activeTask?.correlation_id) return;
      try {
        await api('/api/marketing/agent-team', {
          method: 'POST',
          body: JSON.stringify({ workspace_id: ws(), correlation_id: activeTask.correlation_id, operation: 'review', review: 'revision_needed', feedback: 'Overview Boss requested specialist refinement.' })
        });
        await loadTask(activeTask.correlation_id);
        notify('Overview Boss: Revision requested from specialists.', 'info');
      } catch (err) { notify(err.message, 'error'); }
    });

    // Inter-Agent Message Form Handler
    $('m360-team-msg-form')?.addEventListener('submit', async event => {
      event.preventDefault();
      const input = $('m360-team-msg-input');
      const text = input?.value.trim();
      if (!text || !activeTask?.correlation_id) return;
      try {
        await api('/api/marketing/agent-team', {
          method: 'POST',
          body: JSON.stringify({ workspace_id: ws(), correlation_id: activeTask.correlation_id, operation: 'message', from: 'Overview AI (Boss)', to: 'all', message: text, role: 'boss' })
        });
        input.value = '';
        await loadTask(activeTask.correlation_id);
      } catch (err) { notify(err.message, 'error'); }
    });

    $('m360-btn-export-pitch-deck')?.addEventListener('click', exportBoardroomPitchDeck);

  }



  async function coordinateEngines(operation) {

    if (!activeTask) return notify('Create or open an Outreach campaign first.', 'error');

    const labels = { audience: 'Refreshing audience from Leads & Pipeline…', content: 'Checking saved Content Studio assets…', overview: 'Preparing Overview campaign telemetry…', full: 'Coordinating Leads, Content, Overview and Outreach…' };

    setMktStatus(labels[operation], true);

    try {

      const data = await api('/api/marketing/coordination', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspace_id: ws(), correlation_id: activeTask.correlation_id, operation }) });

      activeTask = normalizeTask(data.task);

      renderCompleteTask();

      if (data.audience) appendTerminalLog('Leads & Pipeline', `${data.audience.count} authorized record(s) attached${data.audience.outbound_blocked ? '; showcase outbound remains blocked' : ''}.`);

      if (data.content) appendTerminalLog('Content Studio', data.content.asset_count ? `${data.content.asset_count} saved asset version(s) attached.` : 'No saved visual asset found; generated text strategy remains ready.');

      if (data.overview) appendTerminalLog('Overview', `Telemetry ready for campaign ${data.overview.correlation_id}.`);

      notify(operation === 'full' ? 'Multi-engine coordination completed.' : labels[operation].replace('…', ' completed.'), 'success');

    } catch (error) { notify(error.message, 'error'); }

    finally { setMktStatus('Ready'); }

  }



  let sendingTest=false;

  function testBlocker(){

    const draft=activeTask?.channel_draft_versions?.Email?.versions?.at(-1);

    const recipient=$('m360-email-test-recipient').value.trim();

    if(!draft)return 'Prepare an Email draft first.';

    if(draft.status!=='approved')return 'Approve Email version '+draft.version+' first.';

    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient))return 'Enter a valid recipient email address.';

    return '';

  }



  function renderTestReadiness(){

    const blocker=testBlocker();

    $('m360-email-test-help').textContent=blocker||'Ready to send this approved draft to the address you entered.';

    $('m360-send-test-email').disabled=sendingTest||Boolean(blocker);

    const quickBtn = $('m360-quick-email-draft');

    if (quickBtn) {

      const needsDraft = !activeTask?.channel_draft_versions?.Email || activeTask.channel_draft_versions.Email.versions.at(-1)?.status !== 'approved';

      quickBtn.style.display = needsDraft ? 'inline-block' : 'none';

    }

  }



  async function sendControlledTestEmail() {

    if (!activeTask?.channel_draft_versions?.Email) return notify('Create a campaign first.', 'error');

    const draft = activeTask.channel_draft_versions.Email.versions.at(-1);

    if (draft.status !== 'approved') return notify('Approve the current Email draft before sending the test.', 'error');

    const recipient = $('m360-email-test-recipient').value.trim();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) return notify('Enter a valid test email address.', 'error');

    const blocker=testBlocker();

    if(sendingTest||blocker)return;

    if(!confirm('Send one copy of Email version '+draft.version+' to '+recipient+'?'))return;

    const taskId=activeTask.correlation_id,workspaceId=ws();

    sendingTest=true;renderTestReadiness();

    setMktStatus('Submitting one Brevo test email…', true);

    try {

      const data = await api('/api/marketing/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspace_id: ws(), correlation_id: activeTask.correlation_id, channel: 'Email', mode: 'live', operator_approved: true, controlled_test: true, test_recipient: recipient, version_hash: draft.version_hash }) });

      appendTerminalLog('Brevo Email Test', `Provider accepted the approved Email draft for ${recipient}. Message ID: ${data.executions?.[0]?.provider_message_ids?.[0] || 'recorded by provider'}.`);

      $('m360-email-provider-status').textContent='Brevo accepted the test email';

      notify(`Brevo accepted the email for ${recipient}. Delivery is not claimed until a verified event arrives.`, 'success');

      if(workspaceId===ws()&&activeTask?.correlation_id===taskId)await loadTask(taskId);

    } catch (error) { $('m360-email-provider-status').textContent=error.message; notify(error.message, 'error'); }

    finally { sendingTest=false;renderTestReadiness();setMktStatus('Ready'); }

  }



  function renderConversation() {

    const history = $('m360-conversation-history');

    if (!history) return;

    history.replaceChildren();

    for (const message of activeConversation?.messages || []) {

      const bubble = document.createElement('p');

      bubble.className = 'm360-conversation-bubble ' + (message.role === 'user' ? 'user' : 'assistant');

      bubble.textContent = `${message.role === 'user' ? 'You' : 'Outreach AI'}: ${message.content}`;

      history.append(bubble);

    }

    if (activeConversation?.status === 'clarification_required') {
      const lastMsg = activeConversation.messages?.slice(-1)[0];
      if (lastMsg && lastMsg.role === 'assistant') {
        const chipWrap = document.createElement('div');
        chipWrap.className = 'm360-quick-reply-chips';
        chipWrap.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin:4px 0 10px 10px;';
        const suggestions = [
          'Target B2B industrial decision-makers with high purchase intent',
          'Focus on commercial retail clients looking for premium solutions',
          'Promote to verified regional prospects in our active service area',
          'Deliver an exclusive limited-time offer to existing opted-in contacts'
        ];
        suggestions.forEach(itemText => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'm360-chip-btn';
          btn.style.cssText = 'padding:4px 10px;font-size:12px;border-radius:14px;background:#eef6f3;border:1px solid #9bc4b5;color:#134e40;cursor:pointer;font-weight:500;';
          btn.textContent = '💡 ' + itemText;
          btn.addEventListener('click', () => {
            const input = $('m360-conversation-input');
            if (input) {
              input.value = itemText;
              $('m360-conversation-form')?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
            }
          });
          chipWrap.appendChild(btn);
        });
        history.appendChild(chipWrap);
      }
    }

  }



  let preparingCampaign=false;

  async function prepareCampaign(message, channel, workspaceId=ws()) {

    if(workspaceId!==ws()||!auth())throw Error('Your workspace session changed.');

    if(channel==='LinkedIn'){await window.Matrix360LinkedIn?.open({objective:message});return;}

    if(preparingCampaign)throw Error('A campaign is already being prepared.');

    preparingCampaign=true;

    setMktStatus('Preparing campaign draft…',true);

    try {

      const path=activeConversation?.status==='clarification_required'

        ? '/api/marketing/conversations/'+activeConversation.conversation_id+'/messages'

        : '/api/marketing/conversations';

      const data=await api(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({workspace_id:workspaceId,message})});

      if(workspaceId!==ws())throw Error('Workspace changed while preparing the campaign.');

      if(data.status==='linkedin_handoff'){
        await window.Matrix360LinkedIn?.open({...data.linkedin,prompt:data.linkedin?.objective||message});
        setMktStatus('LinkedIn campaign brief opened. Prepare and review the publication there.');
        return data;
      }

      activeConversation=data.conversation;

      renderConversation();

      if(data.status!=='dispatched'){

        setMktStatus('What should the campaign be about?');

        return data;

      }

      if(CHANNELS.includes(channel))activeChannel=channel;

      const task=await waitForTask(data.correlation_id);

      if(task.status==='failed')throw Error('Campaign preparation failed. Review the task and try again.');

      setMktStatus('Campaign draft ready to review.');

      return data;

    } finally { preparingCampaign=false; }

  }

  window.M360Outreach={prepareCampaign};



  async function submitMarketingConversation(event) {

    event.preventDefault();

    const input = $('m360-conversation-input'), message = input.value.trim();

    if (!message) return;

    setMktStatus('Preparing campaign conversation…', true);

    try {

      await prepareCampaign(message,activeChannel);

      if(input.value.trim()===message)input.value='';

    } catch (error) { setMktStatus(error.message); notify(error.message, 'error'); }

  }



  function setMktStatus(text, busy = false) {

    if ($('m360-mkt-status-text')) $('m360-mkt-status-text').textContent = text;

    if ($('m360-mkt-spinner')) $('m360-mkt-spinner').hidden = !busy;

  }



  function appendTerminalLog(sender, message) {

    const term = $('m360-terminal-logs');

    if (!term) return;

    const now = new Date().toTimeString().slice(0, 8);

    const line = document.createElement('div');

    line.className = 'm360-term-line';

    line.innerHTML = '<span class="m360-term-ts">[' + now + ']</span> <span class="m360-term-tag">[' + escapeHtml(sender) + ']</span> ' + escapeHtml(message);

    term.appendChild(line);

    term.scrollTop = term.scrollHeight;

  }



  function renderAgentTeamBoard() {
    if (!activeTask) return;
    const board = activeTask.agent_team_board;
    const reviewStatusEl = $('m360-boss-review-status');
    if (reviewStatusEl && board?.supervisor) {
      const isApproved = board.supervisor.review_status === 'approved' || board.supervisor.review_status === 'agreed' || board.supervisor.review_status === 'agreed_approved';
      reviewStatusEl.textContent = isApproved ? '✓ Overview Boss: Deliverables Approved & Ready' : 'Review Status: Deliverables Under Review';
      reviewStatusEl.style.color = isApproved ? 'var(--ws-accent, #15803d)' : 'var(--ws-text, #14532d)';
    }
    const dialogueList = $('m360-team-dialogue-list');
    if (dialogueList && board?.inter_agent_dialogue) {
      dialogueList.innerHTML = board.inter_agent_dialogue.map(msg => {
        const sender = msg.sender || msg.from || 'Agent';
        const isBoss = msg.role === 'boss' || sender.includes('Overview');
        const bg = isBoss ? 'var(--ws-soft, #ecfdf5)' : 'var(--ws-panel, #f8fafc)';
        const border = isBoss ? 'var(--ws-line, #a7f3d0)' : 'var(--ws-line, #e2e8f0)';
        return `<div style="padding:6px 10px; background:${bg}; border:1px solid ${border}; border-radius:6px; font-size:12px; line-height:1.45;">
          <div style="display:flex; justify-content:space-between; margin-bottom:2px;">
            <strong style="color:${isBoss ? 'var(--ws-accent, #047857)' : 'var(--ws-text, #1e293b)'};">${escapeHtml(sender)}:</strong>
            <small style="color:var(--ws-muted, #64748b);">${new Date(msg.timestamp || Date.now()).toLocaleTimeString()}</small>
          </div>
          <span style="color:var(--ws-text, #334155);">${escapeHtml(msg.message || '')}</span>
        </div>`;
      }).join('');
      dialogueList.scrollTop = dialogueList.scrollHeight;
    }
  }

  function exportBoardroomPitchDeck() {
    if (!activeTask) {
      notify('Please create or load a campaign before exporting.', 'error');
      return;
    }
    const printWin = window.open('', '_blank', 'width=900,height=800');
    if (!printWin) {
      notify('Pop-up blocked. Please allow pop-ups for this site.', 'error');
      return;
    }
    const strat = activeTask.strategy || {};
    const framing = strat.pitch_framing || {};
    const segments = strat.core_segments || [];
    const drafts = activeTask.channel_draft_versions || {};
    const channels = Object.keys(drafts);
    const clientName = activeTask.business_name || getActiveClientInfo().clientName;

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Matrix360 Strategic Campaign Pitch Deck - ${escapeHtml(clientName)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #0f172a; margin: 40px; line-height: 1.6; }
    .header { border-bottom: 3px solid #0f766e; padding-bottom: 20px; margin-bottom: 30px; display: flex; justify-content: space-between; align-items: flex-end; }
    h1 { color: #0f766e; margin: 0 0 6px; font-size: 26px; }
    .subtitle { color: #475569; font-size: 14px; margin: 0; }
    .badge { background: #f0fdf4; color: #166534; border: 1px solid #bbf7d0; padding: 4px 10px; border-radius: 6px; font-size: 12px; font-weight: bold; }
    .section { margin-bottom: 30px; page-break-inside: avoid; }
    h2 { color: #1e293b; font-size: 18px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; margin-bottom: 14px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; }
    .card h3 { margin: 0 0 6px; font-size: 14px; color: #0f766e; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 13px; }
    th, td { border: 1px solid #cbd5e1; padding: 8px 12px; text-align: left; }
    th { background: #f1f5f9; color: #1e293b; }
    .footer { margin-top: 40px; font-size: 11px; color: #94a3b8; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 12px; }
    @media print { body { margin: 20px; } .card { border: 1px solid #ccc; } }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>Matrix360 Campaign Pitch Deck</h1>
      <p class="subtitle">Client: <strong>${escapeHtml(clientName)}</strong> &bull; Generated: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
    </div>
    <span class="badge">${activeTask.profile_type === 'b2b_industrial' ? 'B2B Industrial Enterprise' : 'B2C Residential & Hometown Affinity'}</span>
  </div>

  <div class="section">
    <h2>1. Executive Strategic Framing</h2>
    <div class="grid">
      <div class="card">
        <h3>Core Value Proposition</h3>
        <p>${escapeHtml(framing.value_proposition || 'Targeted value proposition tailored to campaign objective.')}</p>
      </div>
      <div class="card">
        <h3>Emotional & Psychological Hook</h3>
        <p>${escapeHtml(framing.emotional_hook || 'Engagement narrative calibrated for target audience response.')}</p>
      </div>
    </div>
  </div>

  <div class="section">
    <h2>2. Target Audience & Persona Segments</h2>
    <table>
      <thead>
        <tr><th>Segment Name</th><th>Affinity & Qualification Signal</th><th>Target Narrative</th></tr>
      </thead>
      <tbody>
        ${segments.map(s => `<tr><td><strong>${escapeHtml(s.name)}</strong></td><td>${escapeHtml(s.affinity_signal)}</td><td>${escapeHtml(s.description || 'High-affinity segment aligned with project value proposition.')}</td></tr>`).join('')}
      </tbody>
    </table>
  </div>

  <div class="section">
    <h2>3. 10-Channel Outreach Matrix & Surgical Messaging</h2>
    <table>
      <thead>
        <tr><th style="width:120px;">Channel</th><th>Subject / Hook</th><th>Message Content</th></tr>
      </thead>
      <tbody>
        ${channels.map(ch => {
          const v = drafts[ch]?.versions?.at(-1);
          return `<tr>
            <td><strong>${escapeHtml(ch)}</strong><br><small style="color:#64748b;">${v?.status === 'approved' ? 'Approved' : 'Draft'}</small></td>
            <td>${escapeHtml(v?.subject || 'Direct Engagement')}</td>
            <td><div style="max-height:120px;overflow:hidden;text-overflow:ellipsis;">${escapeHtml((v?.body || '').slice(0, 300))}${(v?.body || '').length > 300 ? '...' : ''}</div></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  </div>

  <div class="footer">
    Matrix360 Omnichannel Marketing Engine &bull; Confidential &bull; Prepared for Client Boardroom Review
  </div>
  <script>
    window.onload = function() { window.print(); };
  </script>
</body>
</html>`;
    printWin.document.open();
    printWin.document.write(html);
    printWin.document.close();
  }

  function renderCompleteTask() {

    if (!activeTask) return;



    // Strategy & Profile Badge

    if ($('m360-active-client-label')) $('m360-active-client-label').textContent = activeTask.business_name || getActiveClientInfo().clientName;

    if ($('m360-profile-badge')) {

      $('m360-profile-badge').textContent = activeTask.profile_type === 'b2b_industrial' ? 'B2B Industrial Mode' : 'B2C Residential / Affinity Mode';

    }

    const isB2B = activeTask.profile_type === 'b2b_industrial';
    const btnB2B = $('m360-btn-persona-b2b');
    const btnB2C = $('m360-btn-persona-b2c');
    if (btnB2B && btnB2C) {
      btnB2B.style.background = isB2B ? '#0f766e' : '#ffffff';
      btnB2B.style.color = isB2B ? '#ffffff' : '#0f766e';
      btnB2B.style.borderColor = '#0f766e';
      btnB2C.style.background = !isB2B ? '#0f766e' : '#ffffff';
      btnB2C.style.color = !isB2B ? '#ffffff' : '#0f766e';
      btnB2C.style.borderColor = !isB2B ? '#0f766e' : '#cbd5e1';
    }

    const evidenceBody = $('m360-strategy-evidence-body');
    if (evidenceBody) {
      const segs = (activeTask.strategy && activeTask.strategy.core_segments) || [];
      evidenceBody.innerHTML = `
        <div style="margin-bottom:6px;"><strong>• Source Grounding:</strong> Value proposition derived from verified profile for <em>${escapeHtml(activeTask.business_name)}</em>.</div>
        <div style="margin-bottom:6px;"><strong>• Persona Classification:</strong> Categorized as <strong>${isB2B ? 'B2B Industrial Enterprise' : 'B2C Residential & Hometown Affinity'}</strong> based on target customer lifecycle.</div>
        <div style="margin-bottom:6px;"><strong>• Core Audience Segments:</strong> ${segs.map(s => escapeHtml(s.name) + ' (' + escapeHtml(s.affinity_signal) + ')').join('; ')}</div>
        <div><strong>• Channel Suitability:</strong> Omnichannel orchestration across WhatsApp (direct qualification), Email (nurture), and Social (brand reach). 100% compliant with zero unverified claims.</div>
      `;
    }

    renderAgentTeamBoard();

    renderCampaignSummary();

    const strat = activeTask.strategy;

    if ($('m360-strategy-content')) {

      $('m360-strategy-content').innerHTML = `

        <div style="margin-bottom:10px;">

          <strong>Offer direction to review:</strong> ${escapeHtml(strat.pitch_framing.value_proposition)}

        </div>

        <div style="margin-bottom:10px;">

          <strong>Message angle to review:</strong> ${escapeHtml(strat.pitch_framing.emotional_hook)}

        </div>

        <div style="margin-bottom:12px;">

          <strong>Call to Action:</strong> <em>${escapeHtml(strat.pitch_framing.call_to_action)}</em>

        </div>

        <div>

          <strong>Audience groups to review:</strong>

          <ul style="margin:6px 0 0; padding-left:20px; font-size:13px;">

            ${strat.core_segments.map(s => `<li><strong>${escapeHtml(s.name)}:</strong> ${escapeHtml(s.affinity_signal)}</li>`).join('')}

          </ul>

        </div>

      `;

    }



    renderChannelTabs();

    renderActiveChannel();

    renderCalendar();

    renderJourneyRules();

    recalcBudget(+$('m360-slider-budget').value, +$('m360-slider-duration').value);

  }



  function renderCampaignSummary(){

    const task=activeTask;

    const hasDraft=Object.values(task.channel_draft_versions||{}).some(entry=>entry?.versions?.length);

    const objective=task.prompt||task.objective||task.handover_envelope?.objective||task.strategy?.pitch_framing?.value_proposition;

    const updated=new Date(task.updated_at);

    $('m360-campaign-summary').textContent=[objective,hasDraft?'Drafts available to review':task.status==='failed'?'Preparation failed':'Preparing campaign',Number.isFinite(+updated)?'Updated '+updated.toLocaleString():''].filter(Boolean).join(' · ');

    for(const step of $('m360-step-stepper').querySelectorAll('.m360-step')){

      const name=step.id.slice(5),record=(task.step_history||[]).find(item=>item.step===name||item.status===name);

      step.querySelector('small').textContent=record?'Recorded':name==='draft_ready'&&hasDraft?'Available':'Waiting';

    }

    const executions=(task.execution_history||[]).filter(item=>item.status==='provider_accepted');

    const accepted=executions.filter(item=>item.provider!=='brevo_smtp_controlled_test').reduce((sum,item)=>sum+(Number(item.recipient_count)||0),0);

    const tests=executions.filter(item=>item.provider==='brevo_smtp_controlled_test').length;

    $('m360-results-summary').textContent=accepted||tests?'Provider accepted '+accepted+' campaign recipient(s) and '+tests+' test send(s).':'No provider acceptance recorded.';

  }



  async function loadVerifiedResults(){

    const wsId=ws(),taskId=activeTask?.correlation_id;

    const status=$('m360-delivery-events'),button=$('m360-refresh-results');

    if(!taskId){status.textContent='Open a campaign first.';return;}

    button.disabled=true;status.textContent='Checking verified provider events…';

    try{

      const result=await api('/api/marketing/campaigns/'+encodeURIComponent(taskId)+'/results?'+new URLSearchParams({workspace_id:wsId}));

      if(wsId!==ws()||taskId!==activeTask?.correlation_id)return;

      const labels={delivered:'Delivered',opened:'Opened',unique_opened:'Opened',click:'Clicked',clicked:'Clicked',hard_bounce:'Hard bounce',soft_bounce:'Soft bounce',unsubscribed:'Unsubscribed'};

      const events=(result.verified_events||[]).filter(item=>Object.hasOwn(labels,item.event_type)&&Number.isFinite(Date.parse(item.occurred_at)));

      if(!events.length){status.textContent='No verified delivery or engagement events found.';return;}

      const counts=new Map();

      for(const event of events){const label=labels[event.event_type];counts.set(label,(counts.get(label)||0)+1);}

      status.textContent='Recent verified events · '+[...counts].map(([label,count])=>label+' '+count).join(' · ')+'. Latest '+new Date(events[0].occurred_at).toLocaleString()+'.';

    }catch(error){

      if(wsId===ws()&&taskId===activeTask?.correlation_id)status.textContent='Could not load verified events. Try again.';

    }finally{button.disabled=false;}

  }



  function renderLeadsTable(query = $('m360-lead-search').value.trim().toLowerCase()) {

    const tbody = $('m360-leads-tbody');

    if (!tbody) return;

    const all=activeTask?.audience_snapshot?.contacts||[];

    const status=c=>{

      if(c.suppressed||c.unsubscribed)return 'excluded';

      if(activeChannel==='Email'){

        if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email||''))return 'identifier';

        return ['granted','opted_in'].includes(c.email_opt_in_status)&&c.consent_evidence?.email===true?'eligible':'permission';

      }

      if(activeChannel==='WhatsApp'){

        if(!c.phone)return 'identifier';

        return c.whatsapp_opt_in_status==='granted'&&c.consent_evidence?.whatsapp===true?'eligible':'permission';

      }

      return 'unavailable';

    };

    const labels={eligible:'Eligible',permission:'Missing permission',identifier:'Missing contact details',excluded:'Suppressed or unsubscribed',unavailable:'See channel readiness'};

    const filter=$('m360-audience-filter').value;

    const contacts = all.filter(c => {

      if(filter!=='all'&&status(c)!==filter)return false;

      if (!query) return true;

      return (c.name || '').toLowerCase().includes(query) || (c.email || '').toLowerCase().includes(query) || (c.segment && c.segment.toLowerCase().includes(query));

    });



    const counts={eligible:0,permission:0,identifier:0,excluded:0,unavailable:0};

    const names=new Map();

    for(const contact of all){

      counts[status(contact)]++;

      const name=String(contact.name||'').trim().toLowerCase();

      if(name)names.set(name,(names.get(name)||0)+1);

    }

    $('m360-leads-summary-text').textContent=activeChannel+' · '+all.length+' contacts · '+Object.entries(counts).filter(([key,count])=>count||key==='eligible').map(([key,count])=>count+' '+labels[key].toLowerCase()).join(' · ');



    if (contacts.length === 0) {

      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:22px; color:#64748b;">' +

        '<p style="margin:0 0 10px;">No contacts match this view.</p>' +

        '<button type="button" id="m360-goto-leads-btn" style="background:#155b49;color:#fff;border:none;border-radius:6px;padding:6px 14px;font-size:12px;font-weight:600;cursor:pointer;">Discover Prospects in Leads &amp; Pipeline &rarr;</button>' +

        '</td></tr>';

      $('m360-goto-leads-btn')?.addEventListener('click', () => {

        if (window.Matrix360Router?.navigateToPage) {

          window.Matrix360Router.navigateToPage('leads');

        } else {

          const nav = document.querySelector('[data-m360-goto="leads"]') || document.querySelector('a[href="#leads"]');

          if (nav) nav.click();

          else window.location.hash = '#leads';

        }

      });

      return;

    }



    tbody.innerHTML = contacts.map(c => `

      <tr>

        <td><strong>${escapeHtml(c.name || 'Contact')}</strong>${names.get(String(c.name||'').trim().toLowerCase())>1?'<br><small>Repeated name · review in Leads</small>':''}</td>

        <td><code>${escapeHtml(c.email || '')}</code><br><small style="color:#64748b;">${escapeHtml(c.phone || '')}</small>${c.phone && c.phone.replace(/[^0-9]/g, '').length >= 8 ? '<br><a href="https://wa.me/' + encodeURIComponent(c.phone.replace(/[^0-9]/g, '')) + '?text=' + encodeURIComponent(activeTask?.channel_draft_versions?.WhatsApp?.versions?.at(-1)?.body || '') + '" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:2px 7px;font-size:10px;background:#25D366;color:#fff;border-radius:4px;text-decoration:none;font-weight:600;margin-top:3px;">💬 Chat on WhatsApp</a>' : ''}</td>

        <td>

          <span class="m360-tab-badge" style="${c.whatsapp_opt_in_status === 'granted' ? 'background:#dcfce7; color:#166534;' : 'background:#fef3c7; color:#92400e;'}">

            ${labels[status(c)]}

          </span>

        </td>

        <td>${escapeHtml(c.segment || 'General')}</td>

      </tr>

    `).join('');

  }



  function renderCalendar() {

    const grid = $('m360-calendar-grid');

    if (!grid) return;

    const events = Array.isArray(activeTask?.calendar_events) ? activeTask.calendar_events : [];

    if (!calendarCursor) calendarCursor = events.length ? new Date(events[0].scheduled_for) : new Date();

    const year = calendarCursor.getFullYear(), month = calendarCursor.getMonth();

    $('m360-calendar-month').textContent = calendarCursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

    const byDay = new Map();

    for (const event of events) {

      const date = new Date(event.scheduled_for);

      if (Number.isNaN(date.getTime())) continue;

      const parts = new Intl.DateTimeFormat('en', { year: 'numeric', month: 'numeric', day: 'numeric', timeZone: event.timezone || 'Asia/Kolkata' }).formatToParts(date);

      const values = Object.fromEntries(parts.map(part => [part.type, part.value]));

      const key = `${values.year}-${values.month}-${values.day}`;

      if (!byDay.has(key)) byDay.set(key, []);

      byDay.get(key).push(event);

    }

    const weekdays = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

    const cells = weekdays.map(day => `<div role="columnheader" style="font-weight:700;padding:6px;text-align:center;">${day}</div>`);

    const first = new Date(year, month, 1), start = new Date(year, month, 1 - first.getDay());

    const today = new Date(), todayKey = `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;

    for (let index = 0; index < 42; index++) {

      const date = new Date(start); date.setDate(start.getDate() + index);

      const key = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;

      const items = byDay.get(key) || [];

      const muted = date.getMonth() !== month ? 'opacity:.45;' : '';

      const details = items.map(event => `<button type="button" data-calendar-event="${escapeHtml(event.event_id)}" style="display:block;width:100%;margin-top:3px;padding:3px;border:0;border-radius:4px;background:#e8f5ee;font-size:10px;text-align:left;" title="${escapeHtml(String(event.status || '').replaceAll('_',' '))}">${escapeHtml(event.title || event.channel)}</button>`).join('');

      const todayStyle = key === todayKey ? 'display:inline-grid;place-items:center;width:28px;height:28px;border-radius:50%;background:#0b8474;color:white;' : '';

      cells.push(`<div role="gridcell" tabindex="0" data-calendar-date="${key}" aria-label="${escapeHtml(date.toDateString())}" style="min-height:72px;padding:5px;border:1px solid #d7e5df;border-radius:6px;cursor:pointer;${muted}"><strong style="${todayStyle}">${date.getDate()}</strong>${details}</div>`);

    }

    grid.innerHTML = cells.join('');

    grid.querySelectorAll('[data-calendar-date]').forEach(cell => {

      const select = () => { calendarSelectedDate = cell.dataset.calendarDate; calendarSelectedEventId = ''; renderCalendarEditor(); };

      cell.addEventListener('click', event => { if (!event.target.closest('[data-calendar-event]')) select(); });

      cell.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); } });

    });

    grid.querySelectorAll('[data-calendar-event]').forEach(button => button.addEventListener('click', () => { calendarSelectedEventId = button.dataset.calendarEvent; const event = events.find(item => item.event_id === calendarSelectedEventId); calendarSelectedDate = event ? dateInputValue(event.scheduled_for) : ''; renderCalendarEditor(); }));

    const now = new Date(); now.setHours(0,0,0,0); const tomorrow = new Date(now); tomorrow.setDate(now.getDate()+1);

    const active = events.filter(event => event.status !== 'cancelled');

    const completed = active.filter(event => ['published','completed'].includes(event.status)).length;

    const past = active.filter(event => new Date(event.scheduled_for) < now).length;

    const todayCount = active.filter(event => { const date = new Date(event.scheduled_for); return date >= now && date < tomorrow; }).length;

    const upcoming = active.filter(event => new Date(event.scheduled_for) >= tomorrow && !['published','completed'].includes(event.status)).length;

    $('m360-calendar-summary').textContent = `${active.length} campaigns · ${completed} completed · ${past} past dates · ${todayCount} today · ${upcoming} upcoming`;

    renderCalendarEditor();

  }



  function dateInputValue(value) {

    const date = new Date(value); if (Number.isNaN(date.getTime())) return '';

    const offset = date.getTimezoneOffset(); return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 10);

  }



  function renderCalendarEditor() {

    const events = Array.isArray(activeTask?.calendar_events) ? activeTask.calendar_events : [];

    const selected = events.find(event => event.event_id === calendarSelectedEventId);

    if (!calendarSelectedDate) calendarSelectedDate = selected ? dateInputValue(selected.scheduled_for) : dateInputValue(new Date());

    $('m360-calendar-editor-title').textContent = selected ? 'Update campaign' : `Add campaign on ${calendarSelectedDate}`;

    $('m360-calendar-title').value = selected?.title || '';

    $('m360-calendar-channel').value = selected?.channel || activeChannel;

    $('m360-calendar-date').value = selected ? dateInputValue(selected.scheduled_for) : calendarSelectedDate;

    $('m360-calendar-status').value = selected?.status || 'pending_approval';

    $('m360-calendar-save').textContent = selected ? 'Update campaign' : 'Add campaign';

    $('m360-calendar-remove').hidden = !selected;

    const dayEvents = events.filter(event => dateInputValue(event.scheduled_for) === calendarSelectedDate);

    $('m360-calendar-day-events').textContent = dayEvents.length ? dayEvents.map(event => `${event.title} · ${event.channel} · ${event.status.replaceAll('_',' ')}`).join(' | ') : 'No campaigns on this date.';

  }



  async function saveCalendarEvent(event) {

    event.preventDefault(); if (!activeTask) return notify('Start or open an Outreach campaign first.', 'error');

    const selected = activeTask.calendar_events?.find(item => item.event_id === calendarSelectedEventId);

    const method = selected ? 'PATCH' : 'POST';

    const date = $('m360-calendar-date').value;

    try {

      await api('/api/marketing/calendar', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspace_id: ws(), correlation_id: activeTask.correlation_id, event_id: selected?.event_id, title: $('m360-calendar-title').value, channel: $('m360-calendar-channel').value, scheduled_for: new Date(date + 'T09:00:00').toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata', status: $('m360-calendar-status').value }) });

      calendarSelectedEventId = ''; calendarSelectedDate = date; await loadTask(activeTask.correlation_id); notify(selected ? 'Campaign updated.' : 'Campaign added.', 'success');

    } catch (error) { notify(error.message, 'error'); }

  }



  async function removeCalendarEvent() {

    if (!activeTask || !calendarSelectedEventId) return;

    try {

      await api('/api/marketing/calendar', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspace_id: ws(), correlation_id: activeTask.correlation_id, event_id: calendarSelectedEventId }) });

      calendarSelectedEventId = ''; await loadTask(activeTask.correlation_id); notify('Campaign removed from the calendar.', 'success');

    } catch (error) { notify(error.message, 'error'); }

  }



  function renderJourneyRules() {

    const host = $('m360-journey-list'); if (!host) return;

    host.replaceChildren();

    for (const rule of activeTask?.journey_rules || []) {

      const row = document.createElement('div'); row.style.cssText = 'padding:7px;border:1px solid #d7e5df;border-radius:6px;';

      const label = document.createElement('span'); label.textContent = `${rule.name} · ${rule.trigger_event.replaceAll('_',' ')} → ${rule.action.replaceAll('_',' ')} · ${rule.status}`;

      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove'; remove.style.marginLeft = '8px';

      remove.addEventListener('click', async () => { await api('/api/marketing/journeys', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspace_id: ws(), correlation_id: activeTask.correlation_id, rule_id: rule.rule_id }) }); await loadTask(activeTask.correlation_id); });

      row.append(label, remove); host.append(row);

    }

    if (!host.childElementCount) host.textContent = 'No journey rules yet.';

  }



  async function saveJourneyRule(event) {

    event.preventDefault(); if (!activeTask) return notify('Open a campaign first.', 'error');

    try {

      await api('/api/marketing/journeys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspace_id: ws(), correlation_id: activeTask.correlation_id, name: $('m360-journey-name').value, trigger_event: $('m360-journey-trigger').value, action: $('m360-journey-action').value, delay_hours: Number($('m360-journey-delay').value), max_executions: 1, stop_on_reply: true, status: 'draft' }) });

      $('m360-journey-name').value = ''; await loadTask(activeTask.correlation_id); notify('Journey rule saved as a non-executing draft.', 'success');

    } catch (error) { notify(error.message, 'error'); }

  }



  function renderChannelTabs() {

    const tabsContainer = $('m360-channel-tabs');

    if (!tabsContainer || !activeTask?.channel_draft_versions) return;



    const channels=CHANNELS.filter(channel=>activeTask.channel_draft_versions[channel]?.versions?.length);

    $('m360-channels-section').hidden=!channels.length;

    if(!channels.includes(activeChannel))activeChannel=channels[0]||'Email';

    tabsContainer.innerHTML = channels.map(ch => {

      const entry = activeTask.channel_draft_versions[ch];

      const isApproved = entry?.versions[entry.versions.length - 1]?.status === 'approved';

      const vNum = entry?.current_version || 1;

      const isActive = ch === activeChannel;



      return `

        <button type="button" class="m360-tab-pill ${isActive ? 'active' : ''}" data-channel="${ch}" aria-pressed="${isActive}">

          <span>${ch}</span>

          <span class="m360-tab-badge">${isApproved ? 'Approved v' + vNum : 'v' + vNum}</span>

        </button>

      `;

    }).join('');



    tabsContainer.querySelectorAll('.m360-tab-pill').forEach(btn => {

      btn.addEventListener('click', () => {

        activeChannel = btn.getAttribute('data-channel');

        renderChannelTabs();

        renderActiveChannel();

        tabsContainer.querySelector('[aria-pressed="true"]')?.focus();

      });

    });

  }



  function renderActiveChannel() {

    if (!activeTask || !activeTask.channel_draft_versions) return;

    if(activeChannel==='LinkedIn'){
      const entry=activeTask.channel_draft_versions.LinkedIn?.versions?.at(-1);
      window.Matrix360LinkedIn?.open({text:entry?.text_body||entry?.body||entry?.caption||'',title:entry?.subject||''});
      return;
    }



    renderLeadsTable();renderTestReadiness();

    $('m360-active-channel-label').textContent = activeChannel + ' draft';

    const entry = activeTask.channel_draft_versions[activeChannel];

    const curVer = entry?.versions[entry.versions.length - 1];

    $('m360-active-version-pill').textContent = 'v' + (curVer?.version || 1) + ' ' + (curVer?.status === 'approved' ? 'Approved for Release' : 'Draft for Review');



    // 3 Gates

    const readiness = activeTask.channel_readiness?.[activeChannel] || {

      gates: {

        gate1_draft: { status: curVer?.status || 'draft_for_review', label: 'Gate 1: Editorial Draft Status' },

        gate2_audience: { status: 'ineligible', eligible_count: 0, ineligible_count: 0, label: 'Gate 2: Audience Eligibility & Consent' },

        gate3_provider: { status: 'disconnected_connection_required', label: 'Gate 3: Provider Connection Status' }

      }

    };



    const g1 = readiness.gates.gate1_draft;

    const g2 = readiness.gates.gate2_audience;

    const g3 = readiness.gates.gate3_provider;

    const controlledEmailTest = ws() === 'showcase' && activeChannel === 'Email';



    $('m360-gate-container').innerHTML = `

      <div class="m360-gate-item">

        <h4>1. Message approval</h4>

        <div class="m360-gate-val ${g1.status === 'approved' ? 'm360-gate-pass' : 'm360-gate-warn'}">

          ${g1.status === 'approved' ? 'Approved for Release' : 'Draft for Review'}

        </div>

      </div>

      <div class="m360-gate-item">

        <h4>2. Recipient permission</h4>

        <div class="m360-gate-val ${controlledEmailTest || g2.eligible_count > 0 ? 'm360-gate-pass' : 'm360-gate-fail'}">

          ${controlledEmailTest ? 'Your entered test email is used only for this one send' : `${g2.eligible_count ?? 0} opted-in contacts ready`}

        </div>

        ${!controlledEmailTest && g2.eligible_count <= 0 ? '<button type="button" class="m360-gate-leads-btn" style="margin-top:6px;padding:3px 8px;font-size:11px;font-weight:600;background:#155b49;color:#fff;border:none;border-radius:4px;cursor:pointer;">Open Leads &amp; consent details &rarr;</button>' : ''}

      </div>

      <div class="m360-gate-item">

        <h4>3. Sending connection</h4>

        <div class="m360-gate-val ${['connected','verified_connected'].includes(g3.status) ? 'm360-gate-pass' : 'm360-gate-warn'}">

          ${['connected','verified_connected'].includes(g3.status) ? 'Provider Verified' : 'Disconnected (Connection Required)'}

        </div>

      </div>

    `;



    $('btn-approve-channel').disabled=!curVer||curVer.status==='approved';

    $('btn-apply-revision').disabled=!curVer;

    $('m360-edit-draft').disabled=!curVer;

    const launchBtn = $('btn-launch-channel');

    if (launchBtn) {

      launchBtn.style.display = curVer && !controlledEmailTest ? 'inline-block' : 'none';

      launchBtn.disabled=!(g1.passed&&g2.passed&&g2.eligible_count>0&&(activeChannel==='Email'||g3.passed));

      if(activeChannel!=='Email'){

        launchBtn.disabled=true;launchBtn.textContent='Draft only';

        launchBtn.title='Live delivery is currently available through the approved Email provider path.';

      }else if (['connected','verified_connected'].includes(g3.status)) {

        launchBtn.textContent = 'Launch to ' + activeChannel;

        launchBtn.title = launchBtn.disabled?'Approval and recipient permission are required.':'Review the audience before dispatch.';

      } else {

        launchBtn.textContent = 'Launch (Connection Required)';

        launchBtn.title = 'Provider disconnected. Click for required configuration details.';

      }

    }



    const testPreviewBtn = $('btn-test-preview');

    if (testPreviewBtn) {

      testPreviewBtn.style.display = curVer && (activeChannel === 'WhatsApp' || activeChannel === 'Email') ? 'inline-block' : 'none';

      testPreviewBtn.textContent = activeChannel === 'WhatsApp' ? 'Preview WhatsApp message' : 'Preview email without sending';

    }



    document.querySelectorAll('.m360-gate-leads-btn').forEach(btn => {

      btn.addEventListener('click', () => {

        if (window.Matrix360Router?.navigateToPage) {

          window.Matrix360Router.navigateToPage('leads');

        } else {

          const nav = document.querySelector('[data-m360-goto="leads"]') || document.querySelector('a[href="#leads"]');

          if (nav) nav.click();

          else window.location.hash = '#leads';

        }

      });

    });



    // Render Custom Previews based on Channel

    const viewContainer = $('m360-channel-custom-view');

    const textBody = curVer?.body || '';



    if (activeChannel === 'WhatsApp') {

      viewContainer.innerHTML = `

        <div class="m360-wa-mockup">

          <div class="m360-wa-header">

            <span>WhatsApp Business • ${escapeHtml(activeTask.business_name)}</span>

          </div>

          <div class="m360-wa-bubble">${escapeHtml(textBody)}</div>

          <div class="m360-wa-btn-cta">

            Verified tenant sender required before a chat link can be shown

          </div>

        </div>

        <small style="color:#5f7a72; display:block; margin-top:6px;">

          Character count: <strong>${textBody.length}</strong> (Meta WhatsApp max 1,024). Variables: <code>{{contact_name}}</code>, <code>{{project}}</code>.

        </small>

        <div style="margin-top:12px;padding:12px 14px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;">
          <strong style="display:block;font-size:12.5px;color:#166534;margin-bottom:4px;">⚡ 1-Click WhatsApp Web Direct Launcher (CTWA)</strong>
          <p style="margin:0 0 8px;font-size:11.5px;color:#374151;">Test the conversation flow directly in WhatsApp Web with any phone number:</p>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <input type="tel" id="m360-wa-direct-phone" placeholder="Phone with country code (e.g. +91...)" style="flex:1;min-width:200px;padding:5px 8px;font-size:12px;border:1px solid #cbd5e1;border-radius:6px;" />
            <button type="button" id="m360-btn-open-wa-direct" style="background:#25D366;color:#ffffff;font-weight:600;font-size:11.5px;padding:5px 12px;border:none;border-radius:6px;cursor:pointer;">Launch WhatsApp Web &rarr;</button>
          </div>
        </div>

      `;

      $('m360-ctwa-card').style.display = 'block';
      const directWaBtn = $('m360-btn-open-wa-direct');
      if (directWaBtn) {
        directWaBtn.addEventListener('click', () => {
          const ph = ($('m360-wa-direct-phone')?.value || '').replace(/[^0-9]/g, '');
          if (!ph || ph.length < 8) {
            notify('Enter a phone number with country code to launch WhatsApp Web.', 'error');
            return;
          }
          window.open('https://wa.me/' + encodeURIComponent(ph) + '?text=' + encodeURIComponent(textBody), '_blank', 'noopener,noreferrer');
        });
      }

      const bridge = activeTask.email_to_ctwa_bridge;

      $('m360-ctwa-summary').textContent = bridge?.target_contacts_count

        ? `${bridge.target_contacts_count} email-consented contact(s) lack verified WhatsApp opt-in. This is an invitation draft only.`

        : 'No verified email-consented contacts currently qualify for a WhatsApp opt-in invitation.';

    } else if (activeChannel === 'Email') {

      viewContainer.innerHTML = `

        <div class="m360-email-mockup">

          <div class="m360-email-field"><strong>Subject:</strong> ${escapeHtml(curVer?.subject || 'Draft subject not supplied')}</div>

          ${curVer?.preview_text?`<div class="m360-email-field"><strong>Preview text:</strong> ${escapeHtml(curVer.preview_text)}</div>`:'' }

          <div class="m360-email-field"><strong>From:</strong> Verified tenant sender required</div>

          <div class="m360-email-field"><strong>Deliverability:</strong> Not verified; provider connection and domain checks required</div>

          <div class="m360-email-body">${textBody.split(/\r?\n\r?\n/).map(part=>'<p>'+escapeHtml(part)+'</p>').join('')}</div>

          <div style="font-size:11px; color:#888; border-top:1px solid #eee; padding-top:8px;">

            Consent wording and unsubscribe controls must be supplied by the verified provider workflow before sending.

          </div>

        </div>

        <!-- Bulk Email Master Operations Panel -->
        <div style="margin-top:14px; padding:12px 14px; background:#f8fafc; border:1px solid #cbdcd5; border-radius:8px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <strong style="font-size:12.5px; color:#14532d;">🚀 Bulk Email Delivery Engine (Brevo SMTP Relay)</strong>
            <span style="font-size:11px; background:#dcfce7; color:#15803d; padding:2px 8px; border-radius:10px; font-weight:700;">Port 587 STARTTLS</span>
          </div>
          <p style="margin:0 0 8px; font-size:11.5px; color:#475569; line-height:1.5;">
            Authenticated enterprise outbound pipeline. Only contacts with verified opt-in consent (<code>email_consent: true</code>) are included in bulk sends. Template tokens: <code>{{contact_name}}</code>, <code>{{project}}</code>, <code>{{company}}</code>.
          </p>
          <div style="display:flex; gap:12px; align-items:center; flex-wrap:wrap; font-size:11.5px; color:#334155;">
            <span>✓ Batch Pacing: <strong>50 sends/batch (5s throttle)</strong></span>
            <span>✓ Bounce Protection: <strong>Automatic recipient suppression</strong></span>
            <span>✓ Deliverability: <strong>STARTTLS encrypted relay</strong></span>
          </div>
        </div>

      `;

      if(curVer?.email_creative){

        const creative=curVer.email_creative,preview=document.createElement('img'),taskId=activeTask.correlation_id;

        preview.alt='Saved campaign creative included in this Email';preview.style.cssText='max-width:100%;height:auto';

        const body=viewContainer.querySelector('.m360-email-body');

        body.insertBefore(preview,body.children[2]||null);

        api('/api/poster-history?'+new URLSearchParams({workspace_id:ws(),action:'source',poster_id:creative.poster_id,version:creative.version,view:'final'})).then(data=>{if(activeTask?.correlation_id===taskId&&activeChannel==='Email')preview.src=data.source_url;}).catch(()=>{preview.replaceWith(document.createTextNode('Saved image preview unavailable. Reload before approval.'));});

      }

      $('m360-ctwa-card').style.display = 'none';

      if(curVer?.email_creative){const note=document.createElement('p');note.textContent='Attached saved design · version '+curVer.email_creative.version;viewContainer.append(note);}

      if(curVer?.website_url){

        const link=document.createElement('a');link.href=curVer.website_url;link.target='_blank';link.rel='noopener noreferrer';link.textContent='Visit the product website';

        viewContainer.querySelector('.m360-email-body').append(link);

      }

      if(curVer&&!curVer.email_creative){

        const poster=document.createElement('button');

        poster.type='button';poster.textContent='Generate and attach poster (1 image)';

        const note=document.createElement('p');note.setAttribute('role','status');

        poster.addEventListener('click',async()=>{

          if(poster.disabled)return;

          const workspaceId=ws(),taskId=activeTask.correlation_id,brief=activeTask.prompt;

          if(!window.M360ContentAgent){note.textContent='Image generation is unavailable.';return;}

          poster.disabled=true;note.textContent='Creating and saving the email poster…';

          try{

            const creative=await window.M360ContentAgent.create({workspace_id:workspaceId,channel:'Email',prompt:('Create one branded campaign poster for this email brief. Use only approved company facts. '+brief).slice(0,2300)});

            if(workspaceId!==ws()||taskId!==activeTask?.correlation_id)throw Error('Campaign changed. The poster is saved in Content Creation.');

            await api('/api/marketing/coordination',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({workspace_id:workspaceId,correlation_id:taskId,operation:'content',poster_id:creative.poster_id,poster_version:creative.version,email_poster_only:true})});

            await loadTask(taskId);

          }catch(error){note.textContent=error.message;poster.disabled=false;}

        });

        viewContainer.append(poster,note);

      }

    } else if (activeChannel === 'Instagram') {
      viewContainer.innerHTML = `
        <div class="m360-ig-card" style="background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;max-width:440px;margin:12px auto;box-shadow:0 4px 12px rgba(0,0,0,0.06);overflow:hidden;">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid #f1f5f9;">
            <div style="display:flex;align-items:center;gap:10px;">
              <div style="width:34px;height:34px;border-radius:50%;background:linear-gradient(45deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:bold;font-size:14px;">${escapeHtml(activeTask.business_name.charAt(0))}</div>
              <div>
                <strong style="font-size:13px;display:block;color:#0f172a;">${escapeHtml(activeTask.business_name)}</strong>
                <span style="font-size:11px;color:#64748b;">Instagram Organic &bull; Visual Feed</span>
              </div>
            </div>
            <span style="font-size:11px;background:#f3e8ff;color:#7e22ce;padding:2px 8px;border-radius:10px;font-weight:600;">Feed (1:1) / Story (9:16)</span>
          </div>
          <div style="background:#f8fafc;aspect-ratio:1/1;display:flex;flex-direction:column;align-items:center;justify-content:center;border-bottom:1px solid #f1f5f9;color:#64748b;padding:20px;text-align:center;">
            <div style="font-size:36px;margin-bottom:8px;">📸</div>
            <strong style="color:#334155;font-size:14px;margin-bottom:4px;">${curVer?.subject ? escapeHtml(curVer.subject) : 'High-Impact Visual Asset'}</strong>
            <p style="font-size:12px;margin:0;max-width:280px;">Visual artwork grounded in approved brand profile and typography.</p>
          </div>
          <div style="padding:12px 14px;">
            <div style="display:flex;gap:14px;font-size:18px;margin-bottom:8px;color:#334155;">
              <span>❤️</span> <span>💬</span> <span>↗️</span> <span style="margin-left:auto;">🔖</span>
            </div>
            <div style="font-size:13px;line-height:1.5;color:#1e293b;white-space:pre-wrap;"><strong>${escapeHtml(activeTask.business_name)}</strong> ${escapeHtml(textBody)}</div>
          </div>
        </div>
        <small style="color:#5f7a72;display:block;text-align:center;margin-top:6px;">
          Optimized for Instagram Feed &amp; Explore. Character count: <strong>${textBody.length}</strong> chars.
        </small>
      `;
      $('m360-ctwa-card').style.display = 'none';
    } else if (activeChannel === 'Facebook') {
      viewContainer.innerHTML = `
        <div class="m360-fb-card" style="background:#ffffff;border:1px solid #e2e8f0;border-radius:10px;max-width:480px;margin:12px auto;box-shadow:0 2px 8px rgba(0,0,0,0.05);overflow:hidden;padding:14px;">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
            <div style="width:38px;height:38px;border-radius:50%;background:#1877f2;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:16px;">${escapeHtml(activeTask.business_name.charAt(0))}</div>
            <div>
              <strong style="font-size:14px;display:block;color:#0f172a;">${escapeHtml(activeTask.business_name)}</strong>
              <span style="font-size:11px;color:#64748b;">Public &bull; 🌐 Just now</span>
            </div>
          </div>
          <div style="font-size:13.5px;line-height:1.55;color:#1e293b;margin-bottom:12px;white-space:pre-wrap;">${escapeHtml(textBody)}</div>
          <div style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;background:#f8fafc;margin-bottom:10px;">
            <div style="padding:10px 12px;background:#f1f5f9;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;">
              <div>
                <div style="font-size:11px;text-transform:uppercase;color:#64748b;font-weight:600;">Official Solution</div>
                <strong style="font-size:13px;color:#0f172a;">${curVer?.subject ? escapeHtml(curVer.subject) : escapeHtml(activeTask.business_name)}</strong>
              </div>
              <button type="button" style="padding:5px 12px;background:#e2e8f0;color:#0f172a;font-weight:600;font-size:11px;border:none;border-radius:4px;">Learn More</button>
            </div>
          </div>
          <div style="display:flex;justify-content:space-around;border-top:1px solid #f1f5f9;padding-top:10px;color:#64748b;font-size:13px;font-weight:600;">
            <span>👍 Like</span> <span>💬 Comment</span> <span>↗️ Share</span>
          </div>
        </div>
        <small style="color:#5f7a72;display:block;text-align:center;margin-top:6px;">
          Optimized for Facebook Desktop &amp; Mobile News Feed. Character count: <strong>${textBody.length}</strong> chars.
        </small>
      `;
      $('m360-ctwa-card').style.display = 'none';
    } else if (activeChannel === 'LinkedIn') {
      viewContainer.innerHTML = `
        <div class="m360-li-card" style="background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;max-width:500px;margin:12px auto;box-shadow:0 2px 8px rgba(0,0,0,0.04);padding:16px;">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
            <div style="width:42px;height:42px;border-radius:4px;background:#0a66c2;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:18px;">${escapeHtml(activeTask.business_name.charAt(0))}</div>
            <div>
              <strong style="font-size:14px;display:block;color:#0f172a;">${escapeHtml(activeTask.business_name)}</strong>
              <span style="font-size:11px;color:#64748b;">Enterprise Leadership &bull; 1st</span>
              <span style="font-size:11px;color:#64748b;display:block;">Now &bull; 🌐</span>
            </div>
          </div>
          <div style="font-size:13.5px;line-height:1.6;color:#1e293b;margin-bottom:14px;white-space:pre-wrap;">${escapeHtml(textBody)}</div>
          <div style="display:flex;gap:12px;border-top:1px solid #f1f5f9;padding-top:10px;color:#475569;font-size:12px;font-weight:600;">
            <span>👍 Like</span> <span>💡 Insightful</span> <span>👏 Celebrate</span> <span>💬 Comment</span> <span>↗️ Repost</span>
          </div>
        </div>
        <small style="color:#5f7a72;display:block;text-align:center;margin-top:6px;">
          Optimized for LinkedIn B2B C-Suite Reach. Character count: <strong>${textBody.length}</strong> chars.
        </small>
      `;
      $('m360-ctwa-card').style.display = 'none';
    } else {
      viewContainer.innerHTML = `
        <div style="background:#ffffff; border:1px solid #cbdcd5; border-radius:10px; padding:16px; margin:12px 0;">
          <strong style="display:block; font-size:13px; color:#163c32; margin-bottom:6px;">${curVer?.subject ? escapeHtml(curVer.subject) : activeChannel + ' Post Draft'}</strong>
          <div style="font-size:13.5px; line-height:1.55; white-space:pre-wrap; color:#334155;">${escapeHtml(textBody)}</div>
        </div>
        <small style="color:#5f7a72; display:block; margin-top:6px;">
          Character count: <strong>${textBody.length}</strong> chars.
        </small>
      `;
      $('m360-ctwa-card').style.display = 'none';
    }



    // Visual Diff

    const diff = curVer?.diff;

    if (diff && Array.isArray(diff) && diff.length > 0) {

      $('m360-diff-viewer').innerHTML = diff.map(d => {

        if (d.type === 'added') return `<span class="m360-diff-add">+ ${escapeHtml(d.line)}</span>`;

        if (d.type === 'removed') return `<span class="m360-diff-rem">- ${escapeHtml(d.line)}</span>`;

        return `<span class="m360-diff-same">  ${escapeHtml(d.line)}</span>`;

      }).join('');

    } else {

      $('m360-diff-viewer').innerHTML = '<span class="m360-diff-same">Initial version active (v' + (curVer?.version || 1) + '). No revisions recorded yet.</span>';

    }

  }



  async function recalcBudget(budgetInr, durationDays) {

    try {

      const data = await api('/api/marketing/estimate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspace_id: ws(), budget: budgetInr, duration_days: durationDays, profile_type: activeTask?.profile_type, available_sample: activeTask?.audience_snapshot?.total_count || 0 }) });

      const scenarios = data.estimate.scenarios, rows = [['Conservative', scenarios.conservative_low], ['Expected', scenarios.expected_median], ['Optimistic', scenarios.optimistic_high]];

      $('m360-budget-scenarios-card').innerHTML = `<table class="m360-table"><thead><tr><th>Scenario</th><th>Estimated leads</th><th>Estimated CPL</th></tr></thead><tbody>${rows.map(([label, row]) => `<tr><td>${label}</td><td>${row.estimated_leads}</td><td>INR ${Number(row.estimated_cpl_inr).toLocaleString('en-IN')}</td></tr>`).join('')}</tbody></table><small>${data.estimate.badge} · ${escapeHtml(data.estimate.stated_assumptions[0])}</small>`;

      const ab = data.ab_test;

      $('m360-ab-test-content').innerHTML = `<div><strong>Baseline:</strong> ${escapeHtml(ab.baseline_conversion)}</div><div><strong>MDE:</strong> ${escapeHtml(ab.minimum_detectable_lift)}</div><div><strong>Required per arm:</strong> ${Number(ab.sample_size_per_variant).toLocaleString()}</div><div><strong>Total required:</strong> ${Number(ab.total_required_sample_size).toLocaleString()}</div><div><strong>Available reach:</strong> ${Number(ab.available_sample).toLocaleString()}</div><div style="margin-top:6px;font-weight:700;color:${ab.feasible_with_current_reach ? '#166534' : '#991b1b'};">${escapeHtml(ab.feasibility_status.replaceAll('_', ' '))}</div>`;

    } catch (error) {

      if ($('m360-budget-scenarios-card')) $('m360-budget-scenarios-card').textContent = error.message;

    }

  }



  function escapeHtml(str) {

    return String(str || '').replace(/[&<>'"]/g, tag => ({

      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'

    }[tag] || tag));

  }



  // Auto-mount and synchronize with router

  window.addEventListener('popstate', () => { mountMarketingCenter(); loadSavedTaskForWorkspace(ws()); });

  window.addEventListener('hashchange', () => { mountMarketingCenter(); loadSavedTaskForWorkspace(ws()); });

  if (document.readyState === 'loading') {

    document.addEventListener('DOMContentLoaded', mountMarketingCenter);

  } else {

    mountMarketingCenter();

  }

})();

