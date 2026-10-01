/*
 * Short in-memory cache for anonymous catalogue reads (courses, licences,
 * blogs, locations, course locations, jobs). These are the requests every
 * public page and every search-engine render makes, and each one otherwise
 * costs a full round of database queries.
 *
 * Safe by construction:
 *  - only GET requests without an Authorization header are cached, so admins
 *    and signed-in users always get live data (and their own view of it);
 *  - only successful JSON responses are stored;
 *  - any write anywhere in the API (POST/PUT/PATCH/DELETE, including bookings
 *    and the Stripe webhook) empties the whole cache, as does the booking
 *    expiry job when it releases seats;
 *  - entries expire after PUBLIC_CACHE_TTL_SECONDS (default 60) regardless.
 * Set PUBLIC_CACHE_TTL_SECONDS=0 to switch it off.
 */
const TTL_MS = (Number(process.env.PUBLIC_CACHE_TTL_SECONDS ?? 60) || 0) * 1000;
const MAX_ENTRIES = 500;
const PUBLIC_READ = /^\/(courses|licenses|blogs|locations|course-locations|jobs)(\/|$)/;

const cache = new Map(); // originalUrl -> { at, status, body }

function clear() {
  cache.clear();
}

function publicCache(req, res, next) {
  if (req.method !== 'GET') {
    // A write may change any catalogue data; drop everything once it succeeds.
    res.on('finish', () => {
      if (res.statusCode < 400) clear();
    });
    return next();
  }
  if (!TTL_MS || process.env.NODE_ENV === 'test') return next();
  if (!PUBLIC_READ.test(req.path) || req.headers.authorization) return next();

  const key = req.originalUrl;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) {
    res.set('X-Cache', 'HIT');
    return res.status(hit.status).json(hit.body);
  }

  const json = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode === 200) {
      if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value);
      cache.set(key, { at: Date.now(), status: 200, body });
    }
    res.set('X-Cache', 'MISS');
    return json(body);
  };
  next();
}

module.exports = { publicCache, clearPublicCache: clear };
