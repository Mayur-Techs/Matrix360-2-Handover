'use strict';

const WORKSPACE_QUOTAS = new Map();

function checkWorkspaceQuota(workspaceId, requestedCount = 1) {
  const ws = String(workspaceId || 'default').trim();
  const count = Math.max(1, Number(requestedCount) || 1);
  const now = new Date();
  const todayKey = `${ws}:${now.toISOString().slice(0, 10)}`;
  const monthKey = `${ws}:${now.toISOString().slice(0, 7)}`;

  const dailyLimit = Number(process.env.M360_WORKSPACE_DAILY_SEND_QUOTA) || 10000;
  const monthlyLimit = Number(process.env.M360_WORKSPACE_MONTHLY_SEND_QUOTA) || 100000;

  const currentDaily = WORKSPACE_QUOTAS.get(todayKey) || 0;
  const currentMonthly = WORKSPACE_QUOTAS.get(monthKey) || 0;

  if (currentDaily + count > dailyLimit) {
    const err = new Error(`Daily send quota exceeded for workspace (${currentDaily + count}/${dailyLimit}).`);
    err.code = 'QUOTA_EXCEEDED_DAILY';
    err.status = 429;
    throw err;
  }

  if (currentMonthly + count > monthlyLimit) {
    const err = new Error(`Monthly send quota exceeded for workspace (${currentMonthly + count}/${monthlyLimit}).`);
    err.code = 'QUOTA_EXCEEDED_MONTHLY';
    err.status = 429;
    throw err;
  }

  return {
    allowed: true,
    daily: { current: currentDaily, limit: dailyLimit, remaining: dailyLimit - (currentDaily + count) },
    monthly: { current: currentMonthly, limit: monthlyLimit, remaining: monthlyLimit - (currentMonthly + count) }
  };
}

function recordSendQuotaUsage(workspaceId, count = 1) {
  const ws = String(workspaceId || 'default').trim();
  const n = Math.max(0, Number(count) || 0);
  const now = new Date();
  const todayKey = `${ws}:${now.toISOString().slice(0, 10)}`;
  const monthKey = `${ws}:${now.toISOString().slice(0, 7)}`;

  WORKSPACE_QUOTAS.set(todayKey, (WORKSPACE_QUOTAS.get(todayKey) || 0) + n);
  WORKSPACE_QUOTAS.set(monthKey, (WORKSPACE_QUOTAS.get(monthKey) || 0) + n);
}

function resetQuotaStoreForTests() {
  WORKSPACE_QUOTAS.clear();
}

module.exports = {
  checkWorkspaceQuota,
  recordSendQuotaUsage,
  resetQuotaStoreForTests
};
