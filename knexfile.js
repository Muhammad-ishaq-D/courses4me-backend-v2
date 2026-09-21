// Knex CLI configuration — used only by `npm run migrate*`.
// Runtime queries go through src/config/db.js, which reads the same .env.
require('dotenv').config();

const connection = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'courses4me_db',
  multipleStatements: true, // the baseline runs schema.sql as one script
  timezone: 'Z' // all instants are stored and compared in UTC (see src/config/db.js)
};

module.exports = {
  client: 'mysql2',
  connection,
  pool: { min: 0, max: 2 },
  migrations: {
    directory: './database/migrations',
    tableName: 'knex_migrations',
    loadExtensions: ['.js']
  }
};
