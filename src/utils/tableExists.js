const db = require('../config/db');

/**
 * Cached "does this table exist?" probe.
 *
 * Auth reads a few tables owned by other modules (bookings for customer
 * stats, notifications and settings for admin alerts). While a module is not
 * online yet its table is absent, and callers use this to degrade gracefully
 * instead of failing with ER_NO_SUCH_TABLE.
 *
 * A positive answer is cached for the life of the process; a negative answer
 * is re-checked after `NEGATIVE_TTL_MS` so a newly created table is picked up
 * without a restart.
 */
const NEGATIVE_TTL_MS = 60 * 1000;
const cache = new Map(); // table -> { exists, checkedAt }

async function tableExists(table) {
  const hit = cache.get(table);
  if (hit && (hit.exists || Date.now() - hit.checkedAt < NEGATIVE_TTL_MS)) return hit.exists;

  const rows = await db.query(
    'SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1',
    [table]
  );
  const exists = rows.length > 0;
  cache.set(table, { exists, checkedAt: Date.now() });
  return exists;
}

tableExists.reset = () => cache.clear();

module.exports = tableExists;
