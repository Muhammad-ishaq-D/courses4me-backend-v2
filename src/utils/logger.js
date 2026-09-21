/**
 * Minimal leveled logger. LOG_LEVEL=debug|info|warn|error (default: info in
 * production, debug otherwise). Tests run silent unless LOG_LEVEL is set.
 *
 * Request logging stays with morgan; this is for application events.
 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

function currentLevel() {
  if (process.env.LOG_LEVEL) return LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;
  if (process.env.NODE_ENV === 'test') return LEVELS.silent;
  return process.env.NODE_ENV === 'production' ? LEVELS.info : LEVELS.debug;
}

function emit(level, args) {
  if (LEVELS[level] < currentLevel()) return;
  const line = `[${new Date().toISOString()}] [${level.toUpperCase()}]`;
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  fn(line, ...args);
}

module.exports = {
  debug: (...a) => emit('debug', a),
  info: (...a) => emit('info', a),
  warn: (...a) => emit('warn', a),
  error: (...a) => emit('error', a)
};
