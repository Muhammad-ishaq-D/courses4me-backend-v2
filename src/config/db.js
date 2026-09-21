const knex = require('knex');
const dotenv = require('dotenv');
const logger = require('../utils/logger');

dotenv.config({ quiet: true });

const TRANSIENT_CODES = ['ECONNRESET', 'PROTOCOL_CONNECTION_LOST', 'EPIPE', 'ETIMEDOUT'];

// Knex + MySQL2 pool with keep-alive. Remote hosts (Hostinger etc.) drop idle
// sockets, so idle connections are recycled and transient resets are retried.
const db = knex({
  client: 'mysql2',
  connection: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'courses4me_db',
    connectTimeout: 30000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    decimalNumbers: true,
    // Instants (DATETIME/TIMESTAMP) come back as JS Dates in UTC and serialise
    // as ISO strings with a Z. Plain DATE columns (e.g. users.dob) stay as
    // 'YYYY-MM-DD' strings because <input type="date"> expects exactly that.
    timezone: 'Z',
    dateStrings: ['DATE']
  },
  pool: {
    min: 0,
    max: 10,
    acquireTimeoutMillis: 30000,
    idleTimeoutMillis: 30000,
    reapIntervalMillis: 5000,
    createTimeoutMillis: 30000,
    afterCreate: (conn, done) => {
      const errorHandler = (err) => {
        if (err && TRANSIENT_CODES.includes(err.code)) return; // pool reconnects on next query
        if (err) logger.warn('[DB Connection Warning]', err.message);
      };
      conn.on('error', errorHandler);
      if (conn.connection) conn.connection.on('error', errorHandler);
      if (conn._socket) conn._socket.on('error', errorHandler);

      // Session zone = UTC so NOW() and stored instants agree with the driver.
      conn.query("SET time_zone='+00:00';", (err) => {
        if (err) logger.warn('[DB Timezone Warning]', err.message);
        done(null, conn);
      });
    }
  },
  log: {
    warn(message) {
      if (typeof message === 'string' && TRANSIENT_CODES.some(c => message.includes(c))) return;
      logger.warn(message);
    },
    error(message) { logger.error(message); },
    deprecate(message) { logger.warn(message); },
    debug(message) { logger.debug(message); }
  }
});

// Raw SQL helper used by every model: returns rows for SELECT, the result
// packet ({ insertId, affectedRows }) for writes. Retries once on a dropped socket.
async function query(sql, params = [], retries = 2) {
  try {
    const [rows] = await db.raw(sql, params);
    return rows;
  } catch (error) {
    const transient = TRANSIENT_CODES.includes(error.code) || /ECONNRESET/.test(error.message || '');
    if (transient && retries > 0) {
      logger.warn(`[DB Query] ${error.code || 'ECONNRESET'} — retrying (${retries} left)`);
      return query(sql, params, retries - 1);
    }
    logger.error(`Database query error: ${error.message}`);
    throw error;
  }
}

/**
 * Runs `fn(trx)` inside a transaction. `trx.query(sql, params)` has the same
 * contract as `db.query`, so model functions can accept either.
 */
async function withTransaction(fn) {
  return db.transaction(async (knexTrx) => {
    const trx = {
      query: async (sql, params = []) => {
        const [rows] = await knexTrx.raw(sql, params);
        return rows;
      },
      knex: knexTrx
    };
    return fn(trx);
  });
}

// Connection check at boot. A failure is logged, not fatal: the pool retries
// on the next query and the server keeps answering /health.
async function checkConnection() {
  try {
    await db.raw('SELECT 1');
    logger.info('Connected to MySQL (knex + mysql2, keep-alive on)');
    return true;
  } catch (err) {
    logger.error('Failed to connect to MySQL:', err.message);
    return false;
  }
}

db.query = query;
db.withTransaction = withTransaction;
db.checkConnection = checkConnection;

module.exports = db;
module.exports.query = query;
module.exports.withTransaction = withTransaction;
module.exports.checkConnection = checkConnection;
