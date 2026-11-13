'use strict';

const ROLE_PERMISSIONS = Object.freeze({
  platform_owner: Object.freeze({ read: true, write: true, approve: true, send: true, configure_provider: true }),
  agency_admin: Object.freeze({ read: true, write: true, approve: true, send: true, configure_provider: true }),
  client_admin: Object.freeze({ read: true, write: true, approve: true, send: true, configure_provider: true }),
  marketing_operator: Object.freeze({ read: true, write: true, approve: true, send: true, configure_provider: false }),
  sales_operator: Object.freeze({ read: true, write: true, approve: false, send: false, configure_provider: false }),
  viewer: Object.freeze({ read: true, write: false, approve: false, send: false, configure_provider: false })
});

function can(role, action) {
  const normRole = String(role || '').trim().toLowerCase();
  const perms = ROLE_PERMISSIONS[normRole];
  if (!perms) return false;
  return Boolean(perms[action]);
}

function hasRole(role, allowedRoles = []) {
  const normRole = String(role || '').trim().toLowerCase();
  return allowedRoles.map(r => r.toLowerCase()).includes(normRole);
}

module.exports = {
  ROLE_PERMISSIONS,
  can,
  hasPermission: can,
  hasRole
};
