/**
 * Baseline: the schema in database/schema.sql.
 *
 * - Fresh database -> creates every table in schema.sql.
 * - Existing database -> `users` already exists; recorded as applied and
 *   nothing is executed, so `npm run migrate` is always safe to run.
 *
 * Everything after this point is an ordinary knex migration created with
 * `npm run migrate:make <name>`. Never edit this file or schema.sql to add
 * columns or tables.
 */
const fs = require('fs');
const path = require('path');

const SENTINEL_TABLE = 'users';

exports.up = async function (knex) {
  if (await knex.schema.hasTable(SENTINEL_TABLE)) {
    console.log(`[baseline] "${SENTINEL_TABLE}" already exists — schema assumed present, skipping.`);
    return;
  }
  const sql = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  await knex.raw(sql);
};

exports.down = async function () {
  // The baseline is never rolled back: dropping the user tables is a decision
  // for a human with a backup, not a migration.
  throw new Error('The baseline migration cannot be rolled back.');
};
