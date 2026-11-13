'use strict';

/**
 * Matrix360 Phase 6: Owner Analytics Dashboard HTML & Client-Safe Exporter
 * Strictly binds to Stage 3 analytics data layer.
 * Enforces Honest Zeros and Client-Safe CSV export (zero internal IDs/tokens).
 */

/**
 * Generates client-safe CSV export containing only real business metrics.
 * Strictly excludes all internal IDs, tokens, bearer headers, and UUIDs.
 */
function generateClientSafeCsv(analyticsData = {}) {
  const campaigns = Array.isArray(analyticsData.campaigns) ? analyticsData.campaigns : [];
  const headers = [
    'Campaign Name',
    'Channel',
    'Dispatched',
    'Delivered',
    'Opened / Read',
    'Replied / Clicked',
    'Failed',
    'Opted Out / Unsubscribed',
    'Provider Cost (INR)',
    'Matrix360 Platform Fee (INR)',
    'Total Spend (INR)',
    'Delivery Health Status'
  ];

  const rows = [headers.map(h => `"${h}"`).join(',')];

  for (const c of campaigns) {
    const name = String(c.campaign_name || 'Campaign').replace(/"/g, '""');
    const healthStatus = c.delivery_health?.status || 'HEALTHY';

    // WhatsApp row
    if (c.channels?.whatsapp && (c.channels.whatsapp.sent > 0 || c.total_messages_sent === 0)) {
      const wa = c.channels.whatsapp;
      const waCost = c.spend?.whatsapp_provider_cost ?? 0;
      const m360Fee = 0; // explicit separate platform fee
      const totalWa = Number((waCost + m360Fee).toFixed(4));
      rows.push([
        `"${name}"`,
        '"WhatsApp"',
        wa.sent,
        wa.delivered,
        wa.read,
        wa.replied,
        wa.failed,
        wa.opted_out,
        waCost.toFixed(4),
        m360Fee.toFixed(4),
        totalWa.toFixed(4),
        `"${healthStatus}"`
      ].join(','));
    }

    // Email row
    if (c.channels?.email && (c.channels.email.sent > 0 || c.total_messages_sent === 0)) {
      const em = c.channels.email;
      const emCost = c.spend?.email_provider_cost ?? 0;
      const m360Fee = 0;
      const totalEm = Number((emCost + m360Fee).toFixed(4));
      rows.push([
        `"${name}"`,
        '"Email"',
        em.sent,
        em.delivered,
        em.opened,
        em.clicked,
        em.bounced,
        em.unsubscribed,
        emCost.toFixed(4),
        m360Fee.toFixed(4),
        totalEm.toFixed(4),
        `"${healthStatus}"`
      ].join(','));
    }
  }

  return rows.join('\r\n');
}

/**
 * Renders HTML markup for the Analytics Dashboard view.
 */
function renderDashboardHtml(analyticsData = {}) {
  const overview = analyticsData.overview || {};
  const campaigns = Array.isArray(analyticsData.campaigns) ? analyticsData.campaigns : [];
  const hasActivity = analyticsData.has_activity === true || (overview.total_messages_sent || 0) > 0;
  const health = overview.delivery_health || { status: 'HEALTHY', rates: {}, warnings: [] };
  const spend = overview.spend || { total_spend: 0, total_provider_cost: 0, matrix360_platform_fee: 0, whatsapp_provider_cost: 0, email_provider_cost: 0 };

  const waOverview = overview.channels?.whatsapp || { sent: 0, delivered: 0, read: 0, replied: 0, failed: 0, opted_out: 0 };
  const emOverview = overview.channels?.email || { sent: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0, complained: 0, unsubscribed: 0 };

  // Empty state rendering when no campaigns or events exist
  if (!hasActivity && campaigns.length === 0) {
    return `
      <div id="analytics-empty-state" class="empty-state-card">
        <div class="empty-icon">📊</div>
        <h3>No campaigns sent yet. Metrics will appear after your first dispatch.</h3>
        <p>Matrix360 shows real delivery telemetry directly from Meta WhatsApp and Brevo Email webhooks. No simulated numbers or placeholder graphs.</p>
        <div class="empty-status-pill">System Status: Ready for Dispatch</div>
      </div>
    `.trim();
  }

  // Health badge style
  const healthBadgeClass = health.status === 'WARNING' ? 'badge-warning' : 'badge-healthy';

  // Warnings markup
  const warningsHtml = (health.warnings || []).map(w => `
    <div class="warning-alert">
      <strong>⚠️ ${escapeHtml(w.severity)}:</strong> ${escapeHtml(w.message)}
    </div>
  `).join('');

  // Campaigns table rows
  const tableRows = campaigns.map(c => `
    <tr>
      <td>${escapeHtml(c.campaign_name)}</td>
      <td>
        <span class="badge-channel wa-pill">WA: ${c.channels.whatsapp.sent}</span>
        <span class="badge-channel em-pill">EM: ${c.channels.email.sent}</span>
      </td>
      <td>${c.channels.whatsapp.delivered + c.channels.email.delivered}</td>
      <td>${c.channels.whatsapp.read + c.channels.email.opened}</td>
      <td>${c.channels.whatsapp.replied + c.channels.email.clicked}</td>
      <td>${c.channels.whatsapp.failed + c.channels.email.bounced}</td>
      <td>${c.channels.whatsapp.opted_out + c.channels.email.unsubscribed}</td>
      <td>₹${Number(c.spend.total_spend || 0).toFixed(2)}</td>
      <td><span class="badge ${c.delivery_health.status === 'WARNING' ? 'badge-yellow' : 'badge-green'}">${escapeHtml(c.delivery_health.status)}</span></td>
    </tr>
  `).join('');

  return `
    <div class="analytics-dashboard">
      <!-- Spend Breakdown Panel -->
      <div class="spend-panel card">
        <h2>Cross-Channel Spend Breakdown</h2>
        <div class="spend-grid">
          <div class="spend-item">
            <span class="label">Total Spend</span>
            <span class="val">₹${Number(spend.total_spend || 0).toFixed(2)}</span>
          </div>
          <div class="spend-item">
            <span class="label">Meta WhatsApp Cost</span>
            <span class="val">₹${Number(spend.whatsapp_provider_cost || 0).toFixed(2)}</span>
          </div>
          <div class="spend-item">
            <span class="label">Brevo Email Cost</span>
            <span class="val">₹${Number(spend.email_provider_cost || 0).toFixed(2)}</span>
          </div>
          <div class="spend-item highlight-fee">
            <span class="label">Matrix360 Platform Fee</span>
            <span class="val">₹${Number(spend.matrix360_platform_fee || 0).toFixed(2)}</span>
            <small class="fee-note">Transparent 0% markup on direct provider rates</small>
          </div>
        </div>
      </div>

      <!-- Deliverability Health Panel -->
      <div class="health-panel card">
        <div class="panel-header">
          <h2>Deliverability Health</h2>
          <span class="badge ${healthBadgeClass}">${escapeHtml(health.status)}</span>
        </div>
        <div class="health-grid">
          <div class="health-item">
            <span class="label">Email Bounce Rate</span>
            <span class="val">${health.rates?.email_bounce_rate_pct ?? 0}%</span>
            <small class="threshold">Safety Threshold: &le; 5.0%</small>
          </div>
          <div class="health-item">
            <span class="label">Spam Complaint Rate</span>
            <span class="val">${health.rates?.email_complaint_rate_pct ?? 0}%</span>
            <small class="threshold">Safety Threshold: &le; 0.1%</small>
          </div>
          <div class="health-item">
            <span class="label">WhatsApp Opt-Out Rate</span>
            <span class="val">${health.rates?.whatsapp_opt_out_rate_pct ?? 0}%</span>
            <small class="threshold">Safety Threshold: &le; 3.0%</small>
          </div>
        </div>
        ${warningsHtml}
      </div>

      <!-- Cross-Channel Volume Tiles -->
      <div class="volume-cards-grid">
        <div class="card channel-card">
          <h3>WhatsApp Telemetry</h3>
          <div class="metric-row"><span>Sent:</span> <strong>${waOverview.sent}</strong></div>
          <div class="metric-row"><span>Delivered:</span> <strong>${waOverview.delivered}</strong></div>
          <div class="metric-row"><span>Read:</span> <strong>${waOverview.read}</strong></div>
          <div class="metric-row"><span>Replied:</span> <strong>${waOverview.replied}</strong></div>
          <div class="metric-row"><span>Failed:</span> <strong>${waOverview.failed}</strong></div>
          <div class="metric-row"><span>Opted Out:</span> <strong>${waOverview.opted_out}</strong></div>
        </div>

        <div class="card channel-card">
          <h3>Email Telemetry</h3>
          <div class="metric-row"><span>Sent:</span> <strong>${emOverview.sent}</strong></div>
          <div class="metric-row"><span>Delivered:</span> <strong>${emOverview.delivered}</strong></div>
          <div class="metric-row"><span>Opened:</span> <strong>${emOverview.opened}</strong></div>
          <div class="metric-row"><span>Clicked:</span> <strong>${emOverview.clicked}</strong></div>
          <div class="metric-row"><span>Bounced:</span> <strong>${emOverview.bounced}</strong></div>
          <div class="metric-row"><span>Unsubscribed:</span> <strong>${emOverview.unsubscribed}</strong></div>
        </div>
      </div>

      <!-- Live Campaigns Table -->
      <div class="campaigns-panel card">
        <div class="panel-header">
          <h2>Live Campaigns (${campaigns.length})</h2>
          <button id="btn-export-csv" class="btn btn-secondary">Export Client-Safe CSV</button>
        </div>
        <table class="analytics-table">
          <thead>
            <tr>
              <th>Campaign</th>
              <th>Channels</th>
              <th>Delivered</th>
              <th>Opened / Read</th>
              <th>Engagement</th>
              <th>Failed</th>
              <th>Opt-Out</th>
              <th>Spend</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows}
          </tbody>
        </table>
      </div>
    </div>
  `.trim();
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = {
  generateClientSafeCsv,
  renderDashboardHtml
};
