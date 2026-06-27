// Granular permission definitions
const PERMISSIONS = [
  { key: 'VIEW_WATCHLIST',  label: 'View Watchlist',      desc: 'Browse and view entity dossiers' },
  { key: 'ADD_ENTITY',      label: 'Register Entities',   desc: 'Add new subjects to the watchlist' },
  { key: 'EDIT_ENTITY',     label: 'Edit Entities',       desc: 'Update classifications, notes and tags' },
  { key: 'DELETE_ENTITY',   label: 'Purge Entities',      desc: 'Remove entities from the registry' },
  { key: 'REFRESH_ENTITY',  label: 'Refresh API Data',    desc: 'Re-fetch live data from Roblox API' },
  { key: 'BATCH_UPLOAD',    label: 'Batch Upload',        desc: 'Import multiple entities simultaneously' },
  { key: 'VIEW_NETWORK',    label: 'Network View',        desc: 'Access the surveillance grid' },
  { key: 'VIEW_AUDIT',      label: 'Audit Logs',          desc: 'View system audit trail' },
  { key: 'MANAGE_USERS',    label: 'Manage Operators',    desc: 'Admin panel — create and manage accounts' },
];

const ROLE_PERMISSIONS = {
  admin:   PERMISSIONS.map(p => p.key),
  analyst: ['VIEW_WATCHLIST','ADD_ENTITY','EDIT_ENTITY','REFRESH_ENTITY','BATCH_UPLOAD','VIEW_NETWORK','VIEW_AUDIT'],
  viewer:  ['VIEW_WATCHLIST','VIEW_NETWORK'],
};

module.exports = { PERMISSIONS, ROLE_PERMISSIONS };
