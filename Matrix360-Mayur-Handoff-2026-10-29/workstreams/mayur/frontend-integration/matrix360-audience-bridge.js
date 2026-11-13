/**
 * Matrix360 Audience Engine -> Avinash CRM Frontend Bridge
 * Connects Mayur's autonomous lead discovery engine with Avinash's SaaS client dashboard.
 */
(() => {
    'use strict';

    const DEFAULT_ENGINE_ORIGIN = window.MATRIX360_AUDIENCE_ENGINE_URL || 'http://localhost:8765';

    class Matrix360AudienceBridge {
        constructor(engineOrigin = DEFAULT_ENGINE_ORIGIN) {
            this.origin = engineOrigin.replace(/\/+$/, '');
            this.isLive = false;
            this.leadsCount = 0;
        }

        async checkHealth() {
            try {
                const res = await fetch(`${this.origin}/api/health`, { cache: 'no-store' });
                if (res.ok) {
                    const data = await res.json();
                    this.isLive = data.status === 'healthy';
                    return this.isLive;
                }
            } catch (e) {
                this.isLive = false;
            }
            return false;
        }

        async getStatus() {
            try {
                const res = await fetch(`${this.origin}/api/status`, { cache: 'no-store' });
                if (res.ok) return await res.json();
            } catch (e) {}
            return null;
        }

        async getVerifiedLeads(params = {}) {
            const query = new URLSearchParams(params).toString();
            const res = await fetch(`${this.origin}/api/leads?${query}`, { cache: 'no-store' });
            if (!res.ok) throw new Error('Failed to fetch verified leads');
            return await res.json();
        }

        async pushLeadsToCrm(workspaceId, authToken, crmApiBase = window.Matrix360ApiBase, stage = 'qualified', limit = 100) {
            const res = await fetch(`${this.origin}/api/leads/push-to-crm`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    workspace_id: workspaceId,
                    auth_token: authToken,
                    crm_api_base: crmApiBase || 'http://localhost:8000',
                    stage: stage,
                    limit: limit
                })
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.message || `Push failed: HTTP ${res.status}`);
            }
            return await res.json();
        }

        /**
         * Automatically enhances Avinash's client-dashboard.html feature card
         * when included on the client dashboard page.
         */
        async attachToDashboard() {
            const card = document.querySelector('.card.feature:has(strong:contains("Audience intelligence")), .card.feature:nth-child(2)');
            if (!card) return;

            const isOnline = await this.checkHealth();
            if (isOnline) {
                const status = await this.getStatus();
                const count = status ? status.leads_in_db : 0;

                // Update badge to LIVE
                const tag = card.querySelector('.tag');
                if (tag) {
                    tag.className = 'tag tag-live';
                    tag.innerText = 'ENGINE CONNECTED';
                    tag.style.background = '#e6f5e8';
                    tag.style.color = '#136248';
                }

                const desc = card.querySelector('p');
                if (desc) {
                    desc.innerHTML = `<strong>${count} verified B2B leads</strong> ready in Mayur's Autonomous Engine. Verified emails, valid phones &amp; executive LinkedIn profiles.`;
                }

                const link = card.querySelector('a');
                if (link) {
                    link.href = this.origin;
                    link.target = '_blank';
                    link.innerText = 'Open Audience Engine →';
                }
            }
        }
    }

    window.Matrix360AudienceBridge = Matrix360AudienceBridge;

    // Auto-initialize if DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            const bridge = new Matrix360AudienceBridge();
            bridge.attachToDashboard();
        });
    } else {
        const bridge = new Matrix360AudienceBridge();
        bridge.attachToDashboard();
    }
})();
