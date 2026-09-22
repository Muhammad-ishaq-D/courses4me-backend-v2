const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

/**
 * In-memory stand-in for src/config/db.
 *
 * `query(sql, params)` understands the SQL the auth models emit and keeps
 * real state (users, activity logs, devices, password resets, audit logs), so controller
 * flows — login, register, OTP -> reset token -> reset — can be exercised end
 * to end without MySQL. Anything unrecognised returns [] / affectedRows 0.
 *
 * Usage:
 *   const mockDb = createMockDb({ users: [{ id: 1, email: 'a@b.c', password: 'Secret1!', role: 'admin' }] });
 *   jest.mock('../src/config/db', () => mockDb);
 */
function createMockDb({ users = [], courses = [] } = {}) {
  const now = () => new Date();
  const state = {
    users: [],
    activity: [],
    devices: [],
    resets: [],
    audit: [],
    courses: [],
    courseListItems: [],
    courseVenues: [],
    courseSchedules: [],
    seq: { users: 0, activity: 0, devices: 0, resets: 0, audit: 0, courses: 0, courseListItems: 0, courseVenues: 0, courseSchedules: 0 },
    tables: new Set([
      'users', 'user_activity_logs', 'user_devices', 'password_resets', 'audit_logs',
      'courses', 'course_list_items', 'course_venues', 'course_venue_schedules'
    ]),
    log: []
  };

  const nextId = (t) => ++state.seq[t];

  function seedUser(u) {
    const id = u.id || nextId('users');
    state.seq.users = Math.max(state.seq.users, id);
    state.users.push({
      id,
      name: u.name || 'Test User',
      email: String(u.email).toLowerCase(),
      password_hash: u.password ? bcrypt.hashSync(u.password, 4) : (u.password_hash ?? null),
      google_id: u.google_id ?? null,
      facebook_id: u.facebook_id ?? null,
      phone: u.phone ?? null,
      dob: u.dob ?? null,
      billing_postcode: null, billing_line1: null, billing_line2: null, billing_city: null,
      role: u.role || 'customer',
      job_title: null, bio: null,
      profile_image: u.profile_image ?? null,
      token_version: u.token_version ?? 0,
      status: u.status || 'active',
      status_reason: u.status_reason ?? null,
      last_login_at: null, last_active_at: null,
      failed_login_attempts: u.failed_login_attempts ?? 0,
      locked_until: u.locked_until ?? null,
      created_at: now(), updated_at: now()
    });
    return id;
  }
  users.forEach(seedUser);

  function seedCourse(c) {
    const id = c.id || nextId('courses');
    state.seq.courses = Math.max(state.seq.courses, id);
    const { highlights, learningPoints, targetAudience, requirements, locations, pricing, instructor, ...rest } = c;
    state.courses.push({
      id,
      title: c.title || 'Test Course',
      category: c.category || 'SIA Training',
      subtitle: null, level: 'Level 2', duration: c.duration || '1 Day',
      reviews_count: '1,000+', booked_count: '500+', pass_rate: '98%',
      short_description: c.short_description || 'A short description of the course offering.',
      full_description: c.full_description || 'Full description.',
      guarantee_title: 'Training Guarantee', guarantee_description: 'Free exam retakes',
      thumbnail: null,
      base_price: c.base_price ?? 100, sale_price: null, original_price: null,
      location_id: null, center_id: null, center_name: null,
      instructor_name: null, instructor_title: null, instructor_bio: null, instructor_photo: null,
      status: c.status || 'Published',
      is_popular: c.is_popular ?? 0,
      created_at: c.created_at ? new Date(c.created_at) : now(),
      updated_at: now(),
      ...rest,
      id
    });
    return id;
  }
  courses.forEach(seedCourse);

  // Handles the SQL emitted by courseModel / courseSessionService / licenseLookupService.
  function routeCourses(q, params) {
    // reads
    if (/^SELECT id, title, category.* FROM courses WHERE id = \? LIMIT 1/.test(q)) {
      const c = state.courses.find(x => x.id === Number(params[0]));
      return c ? [{ ...c }] : [];
    }
    if (/^SELECT id FROM courses WHERE title LIKE \? LIMIT 1/.test(q)) {
      const needle = String(params[0]).replace(/%/g, '').toLowerCase();
      const c = state.courses.find(x => x.title.toLowerCase().includes(needle));
      return c ? [{ id: c.id }] : [];
    }
    if (/FROM courses c( WHERE .*)? ORDER BY c\.created_at DESC/.test(q)) {
      let rows = [...state.courses];
      let i = 0;
      if (/c\.category = \?/.test(q)) { const v = params[i++]; rows = rows.filter(c => c.category === v); }
      if (/c\.status = \?/.test(q)) { const v = params[i++]; rows = rows.filter(c => c.status === v); }
      if (/c\.title LIKE \?/.test(q)) {
        const needle = String(params[i]).replace(/%/g, '').toLowerCase(); i += 2;
        rows = rows.filter(c => [c.title, c.short_description].some(f => f && f.toLowerCase().includes(needle)));
      }
      if (/EXISTS \(SELECT 1 FROM course_venues/.test(q)) {
        const needle = String(params[i]).replace(/%/g, '').toLowerCase(); i += 3;
        rows = rows.filter(c => state.courseVenues.some(v => v.course_id === c.id &&
          [v.name, v.address, v.postcode].some(f => f && f.toLowerCase().includes(needle))));
      }
      rows.sort((a, b) => b.created_at - a.created_at || b.id - a.id);
      return rows.map(c => ({ ...c }));
    }
    if (/^SELECT category, COUNT\(\*\) AS total FROM courses/.test(q)) {
      const rows = /WHERE status = \?/.test(q) ? state.courses.filter(c => c.status === params[0]) : state.courses;
      const counts = {};
      for (const c of rows) counts[c.category] = (counts[c.category] || 0) + 1;
      return Object.entries(counts).map(([category, total]) => ({ category, total }));
    }
    if (/^SELECT course_id, type, value FROM course_list_items WHERE course_id IN \(\?\)/.test(q)) {
      const ids = params[0].map(Number);
      return state.courseListItems.filter(l => ids.includes(l.course_id))
        .sort((a, b) => a.type.localeCompare(b.type) || a.position - b.position || a.id - b.id)
        .map(l => ({ course_id: l.course_id, type: l.type, value: l.value }));
    }
    if (/FROM course_venues WHERE course_id IN \(\?\)/.test(q)) {
      const ids = params[0].map(Number);
      return state.courseVenues.filter(v => ids.includes(v.course_id))
        .sort((a, b) => a.course_id - b.course_id || a.position - b.position || a.id - b.id)
        .map(v => ({ ...v }));
    }
    if (/FROM course_venue_schedules WHERE course_venue_id IN \(\?\)/.test(q)) {
      const ids = params[0].map(Number);
      return state.courseSchedules.filter(s => ids.includes(s.course_venue_id))
        .sort((a, b) => a.course_venue_id - b.course_venue_id || a.position - b.position || a.id - b.id)
        .map(s => ({ ...s }));
    }

    // writes
    if (/^INSERT INTO courses \(/.test(q)) {
      const cols = q.match(/^INSERT INTO courses \(([^)]+)\)/)[1].split(',').map(x => x.trim());
      const data = {}; cols.forEach((c, i) => { data[c] = params[i]; });
      return { insertId: seedCourse(data), affectedRows: 1 };
    }
    if (/^INSERT INTO course_list_items/.test(q)) {
      for (let i = 0; i < params.length; i += 4) {
        state.courseListItems.push({ id: nextId('courseListItems'), course_id: Number(params[i]), type: params[i + 1], position: params[i + 2], value: params[i + 3] });
      }
      return { insertId: state.seq.courseListItems, affectedRows: params.length / 4 };
    }
    if (/^INSERT INTO course_venues/.test(q)) {
      const [course_id, position, name, address, postcode, latitude, longitude, parking_main, parking_sub, commute_main, commute_sub] = params;
      const id = nextId('courseVenues');
      state.courseVenues.push({ id, course_id: Number(course_id), position, name, address, postcode, latitude, longitude, parking_main, parking_sub, commute_main, commute_sub });
      return { insertId: id, affectedRows: 1 };
    }
    if (/^INSERT INTO course_venue_schedules/.test(q)) {
      for (let i = 0; i < params.length; i += 8) {
        state.courseSchedules.push({
          id: nextId('courseSchedules'), course_venue_id: Number(params[i]), position: params[i + 1],
          time: params[i + 2], start_date: params[i + 3], end_date: params[i + 4],
          price: params[i + 5], seats_available: params[i + 6], availability_status: params[i + 7]
        });
      }
      return { insertId: state.seq.courseSchedules, affectedRows: params.length / 8 };
    }
    if (/^UPDATE courses SET .* WHERE id = \?$/.test(q)) {
      const sets = q.match(/^UPDATE courses SET (.*) WHERE id = \?$/)[1].split(',').map(x => x.trim().split(' = ')[0]);
      const c = state.courses.find(x => x.id === Number(params[params.length - 1]));
      if (!c) return { affectedRows: 0 };
      sets.forEach((col, i) => { c[col] = params[i]; });
      c.updated_at = now();
      return { affectedRows: 1 };
    }
    if (/^DELETE FROM course_list_items WHERE course_id = \? AND type IN \(\?\)/.test(q)) {
      const types = params[1];
      const before = state.courseListItems.length;
      state.courseListItems = state.courseListItems.filter(l => !(l.course_id === Number(params[0]) && types.includes(l.type)));
      return { affectedRows: before - state.courseListItems.length };
    }
    if (/^DELETE FROM course_venues WHERE course_id = \?/.test(q)) {
      const venueIds = state.courseVenues.filter(v => v.course_id === Number(params[0])).map(v => v.id);
      state.courseVenues = state.courseVenues.filter(v => v.course_id !== Number(params[0]));
      state.courseSchedules = state.courseSchedules.filter(s => !venueIds.includes(s.course_venue_id));
      return { affectedRows: venueIds.length };
    }
    if (/^DELETE FROM courses WHERE id = \?/.test(q)) {
      const id = Number(params[0]);
      const before = state.courses.length;
      state.courses = state.courses.filter(c => c.id !== id);
      const removed = before - state.courses.length;
      if (removed) {
        state.courseListItems = state.courseListItems.filter(l => l.course_id !== id);
        const venueIds = state.courseVenues.filter(v => v.course_id === id).map(v => v.id);
        state.courseVenues = state.courseVenues.filter(v => v.course_id !== id);
        state.courseSchedules = state.courseSchedules.filter(s => !venueIds.includes(s.course_venue_id));
      }
      return { affectedRows: removed };
    }
    return undefined;
  }

  const userRow = (u) => u ? { ...u } : null;
  const where = (rows, fn) => rows.filter(fn);

  function route(sql, params = []) {
    const q = sql.replace(/\s+/g, ' ').trim();
    state.log.push({ sql: q, params });

    // ── schema probe (tableExists) ────────────────────────────────────────
    if (/FROM information_schema\.tables/.test(q)) return state.tables.has(params[0]) ? [{ 1: 1 }] : [];

    // ── users: reads ──────────────────────────────────────────────────────
    if (/FROM users WHERE id = \? LIMIT 1/.test(q)) return where(state.users, u => u.id === Number(params[0])).map(userRow);
    if (/^SELECT 1 FROM users WHERE email = \?/.test(q)) return where(state.users, u => u.email === params[0]).map(() => ({ 1: 1 }));
    if (/FROM users WHERE email = \? LIMIT 1/.test(q)) return where(state.users, u => u.email === params[0]).map(userRow);
    if (/FROM users WHERE google_id = \?/.test(q)) return where(state.users, u => u.google_id === params[0]).map(userRow);
    if (/FROM users WHERE facebook_id = \?/.test(q)) return where(state.users, u => u.facebook_id === params[0]).map(userRow);
    if (/FROM users WHERE id IN \(\?\)/.test(q)) return where(state.users, u => params[0].map(Number).includes(u.id)).map(userRow);
    if (/SELECT role, COUNT\(\*\) AS total FROM users GROUP BY role/.test(q)) {
      const counts = {};
      for (const u of state.users) counts[u.role] = (counts[u.role] || 0) + 1;
      return Object.entries(counts).map(([role, total]) => ({ role, total }));
    }
    if (/SELECT id FROM users WHERE role IN \('admin','editor'\)/.test(q)) return where(state.users, u => ['admin', 'editor'].includes(u.role)).map(u => ({ id: u.id }));
    if (/^SELECT id, name, email.* FROM users( WHERE .*)? ORDER BY created_at DESC/.test(q)) {
      // admin list with optional filters (status = ?, role = ?, LIKE search)
      let rows = [...state.users];
      let i = 0;
      if (/status = \?/.test(q)) { const v = params[i++]; rows = rows.filter(u => u.status === v); }
      if (/role = \?/.test(q)) { const v = params[i++]; rows = rows.filter(u => u.role === v); }
      if (/name LIKE \?/.test(q)) {
        const needle = String(params[i]).replace(/%/g, '').toLowerCase(); i += 3;
        rows = rows.filter(u => [u.name, u.email, u.phone].some(f => f && String(f).toLowerCase().includes(needle)));
      }
      rows.sort((a, b) => b.created_at - a.created_at || b.id - a.id);
      return rows.map(userRow);
    }

    // ── users: writes ─────────────────────────────────────────────────────
    if (/^INSERT INTO users \(/.test(q)) {
      const cols = q.match(/^INSERT INTO users \(([^)]+)\)/)[1].split(',').map(s => s.trim());
      const data = {}; cols.forEach((c, i) => { data[c] = params[i]; });
      if (state.users.some(u => u.email === data.email)) { const e = new Error('Duplicate entry'); e.code = 'ER_DUP_ENTRY'; throw e; }
      const id = seedUser({ ...data, id: undefined, password: undefined, password_hash: data.password_hash ?? null });
      return { insertId: id, affectedRows: 1 };
    }
    if (/^UPDATE users SET last_login_at = UTC_TIMESTAMP\(\)/.test(q)) {
      const u = state.users.find(x => x.id === Number(params[0])); if (u) { u.last_login_at = now(); u.last_active_at = now(); }
      return { affectedRows: u ? 1 : 0 };
    }
    // login lockout
    if (/^UPDATE users SET failed_login_attempts = \?, locked_until = UTC_TIMESTAMP\(\) \+ INTERVAL \? MINUTE WHERE id = \?/.test(q)) {
      const u = state.users.find(x => x.id === Number(params[2]));
      if (u) { u.failed_login_attempts = params[0]; u.locked_until = new Date(Date.now() + params[1] * 60000); }
      return { affectedRows: u ? 1 : 0 };
    }
    if (/^UPDATE users SET failed_login_attempts = \? WHERE id = \?/.test(q)) {
      const u = state.users.find(x => x.id === Number(params[1])); if (u) u.failed_login_attempts = params[0];
      return { affectedRows: u ? 1 : 0 };
    }
    if (/^UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = \?/.test(q)) {
      const u = state.users.find(x => x.id === Number(params[0])); if (u) { u.failed_login_attempts = 0; u.locked_until = null; }
      return { affectedRows: u ? 1 : 0 };
    }
    if (/^UPDATE users SET password_hash = \?, token_version = token_version \+ 1 WHERE id = \?/.test(q)) {
      const u = state.users.find(x => x.id === Number(params[1])); if (u) { u.password_hash = params[0]; u.token_version += 1; }
      return { affectedRows: u ? 1 : 0 };
    }
    if (/^UPDATE users SET .* WHERE id = \?$/.test(q)) {
      const sets = q.match(/^UPDATE users SET (.*) WHERE id = \?$/)[1].split(',').map(s => s.trim().split(' = ')[0]);
      const u = state.users.find(x => x.id === Number(params[params.length - 1]));
      if (!u) return { affectedRows: 0 };
      const emailIdx = sets.indexOf('email');
      if (emailIdx !== -1 && state.users.some(x => x.id !== u.id && x.email === params[emailIdx])) {
        const e = new Error('Duplicate entry'); e.code = 'ER_DUP_ENTRY'; throw e;
      }
      sets.forEach((c, i) => { u[c] = params[i]; });
      return { affectedRows: 1 };
    }

    // ── courses ───────────────────────────────────────────────────────────
    if (/\bcourses?\b|course_list_items|course_venues|course_venue_schedules|course_locations/.test(q)) {
      const handled = routeCourses(q, params);
      if (handled !== undefined) return handled;
    }

    // ── activity log ──────────────────────────────────────────────────────
    if (/^INSERT INTO user_activity_logs/.test(q)) {
      const [user_id, action, details, reason, admin_name] = params;
      const id = nextId('activity');
      state.activity.push({ id, user_id: Number(user_id), action, details, reason, admin_name, created_at: now() });
      return { insertId: id, affectedRows: 1 };
    }
    if (/^SELECT .* FROM user_activity_logs WHERE user_id = \?/.test(q)) return where(state.activity, a => a.user_id === Number(params[0]));
    if (/^SELECT .* FROM user_activity_logs WHERE user_id IN \(\?\)/.test(q)) return where(state.activity, a => params[0].map(Number).includes(a.user_id));
    if (/^DELETE FROM user_activity_logs WHERE user_id = \?/.test(q)) {
      const before = state.activity.length; state.activity = state.activity.filter(a => a.user_id !== Number(params[0]));
      return { affectedRows: before - state.activity.length };
    }

    // ── devices ───────────────────────────────────────────────────────────
    if (/SELECT id FROM user_devices WHERE user_id = \? AND fingerprint = \?/.test(q)) {
      return where(state.devices, d => d.user_id === Number(params[0]) && d.fingerprint === params[1]).map(d => ({ id: d.id }));
    }
    if (/^INSERT INTO user_devices/.test(q)) {
      const [user_id, fingerprint, user_agent, ip] = params;
      state.devices.push({ id: nextId('devices'), user_id: Number(user_id), fingerprint, user_agent, ip, first_seen_at: now() });
      return { insertId: state.seq.devices, affectedRows: 1 };
    }
    if (/^DELETE FROM user_devices WHERE user_id = \? AND id NOT IN/.test(q)) return { affectedRows: 0 };

    // ── audit log ─────────────────────────────────────────────────────────
    if (/^INSERT INTO audit_logs/.test(q)) {
      const [user_id, actor_id, action, success, details, ip_address, user_agent, request_id] = params;
      const id = nextId('audit');
      state.audit.push({ id, user_id, actor_id, action, success, details, ip_address, user_agent, request_id, created_at: now() });
      return { insertId: id, affectedRows: 1 };
    }

    // ── password resets ───────────────────────────────────────────────────
    if (/^SELECT COUNT\(\*\) AS total FROM password_resets WHERE user_id = \? AND last_sent_at > UTC_TIMESTAMP\(\) - INTERVAL \? MINUTE/.test(q)) {
      const since = Date.now() - params[1] * 60000;
      return [{ total: state.resets.filter(r => r.user_id === Number(params[0]) && r.last_sent_at.getTime() > since).length }];
    }
    if (/^INSERT INTO password_resets/.test(q)) {
      const [user_id, otp_hash, otp_expires_at, otp_consumed_at, reset_token_hash, reset_token_expires_at, request_ip, user_agent] = params;
      const id = nextId('resets');
      state.resets.push({ id, user_id: Number(user_id), otp_hash, otp_expires_at, attempts: 0, last_sent_at: now(), otp_consumed_at, reset_token_hash, reset_token_expires_at, reset_token_consumed_at: null, request_ip, user_agent });
      return { insertId: id, affectedRows: 1 };
    }
    if (/^DELETE FROM password_resets WHERE id = \?/.test(q)) {
      const before = state.resets.length; state.resets = state.resets.filter(r => r.id !== Number(params[0]));
      return { affectedRows: before - state.resets.length };
    }
    if (/^UPDATE password_resets SET otp_consumed_at = UTC_TIMESTAMP\(\) WHERE user_id = \? AND otp_consumed_at IS NULL/.test(q)) {
      let n = 0; for (const r of state.resets) if (r.user_id === Number(params[0]) && !r.otp_consumed_at) { r.otp_consumed_at = now(); n++; }
      return { affectedRows: n };
    }
    if (/^UPDATE password_resets SET reset_token_consumed_at = UTC_TIMESTAMP\(\) WHERE user_id = \?/.test(q)) {
      let n = 0; for (const r of state.resets) if (r.user_id === Number(params[0]) && r.reset_token_hash && !r.reset_token_consumed_at) { r.reset_token_consumed_at = now(); n++; }
      return { affectedRows: n };
    }
    if (/WHERE pr\.otp_hash = \? AND pr\.otp_consumed_at IS NULL AND pr\.otp_expires_at > UTC_TIMESTAMP\(\)/.test(q)) {
      return where(state.resets, r => r.otp_hash === params[0] && !r.otp_consumed_at && r.otp_expires_at > now())
        .map(r => ({ id: r.id, user_id: r.user_id, attempts: r.attempts, user_role: state.users.find(u => u.id === r.user_id)?.role }));
    }
    if (/^UPDATE password_resets SET attempts = attempts \+ 1 WHERE id = \?/.test(q)) {
      const r = state.resets.find(x => x.id === Number(params[0])); if (r) r.attempts += 1;
      return { affectedRows: r ? 1 : 0 };
    }
    if (/^UPDATE password_resets SET otp_consumed_at = UTC_TIMESTAMP\(\), reset_token_hash = \?, reset_token_expires_at = \? WHERE id = \?/.test(q)) {
      const r = state.resets.find(x => x.id === Number(params[2]) && !x.otp_consumed_at && x.otp_expires_at > now());
      if (r) { r.otp_consumed_at = now(); r.reset_token_hash = params[0]; r.reset_token_expires_at = params[1]; }
      return { affectedRows: r ? 1 : 0 };
    }
    if (/WHERE pr\.reset_token_hash = \? AND pr\.reset_token_consumed_at IS NULL AND pr\.reset_token_expires_at > UTC_TIMESTAMP\(\)/.test(q)) {
      return where(state.resets, r => r.reset_token_hash === params[0] && !r.reset_token_consumed_at && r.reset_token_expires_at > now())
        .map(r => ({ id: r.id, user_id: r.user_id, user_role: state.users.find(u => u.id === r.user_id)?.role }));
    }
    if (/^UPDATE password_resets SET reset_token_consumed_at = UTC_TIMESTAMP\(\) WHERE id = \?/.test(q)) {
      const r = state.resets.find(x => x.id === Number(params[0]) && !x.reset_token_consumed_at && x.reset_token_expires_at > now());
      if (r) r.reset_token_consumed_at = now();
      return { affectedRows: r ? 1 : 0 };
    }
    if (/^DELETE FROM password_resets WHERE otp_expires_at </.test(q)) return { affectedRows: 0 };

    // ── notifications / settings (not migrated yet: tables absent) ────────
    if (/^INSERT/i.test(q)) return { insertId: 0, affectedRows: 1 };
    if (/^UPDATE|^DELETE/i.test(q)) return { affectedRows: 0 };
    return [];
  }

  const query = jest.fn(async (sql, params) => route(sql, params));

  return {
    query,
    withTransaction: jest.fn(async (fn) => fn({ query })),
    checkConnection: jest.fn(async () => true),
    raw: jest.fn(async () => [[]]),
    destroy: jest.fn(async () => {}),
    state,
    /** Make tableExists() report a later-module table as present. */
    addTable: (name) => state.tables.add(name),
    findUser: (email) => state.users.find(u => u.email === String(email).toLowerCase()),
    findCourse: (title) => state.courses.find(c => c.title === title)
  };
}

/** A JWT exactly as the API issues it (same issuer/audience/algorithm). */
function tokenFor(user, overrides = {}) {
  return jwt.sign(
    { id: user.id, role: user.role, tokenVersion: user.token_version ?? 0, ...overrides },
    process.env.JWT_SECRET,
    { expiresIn: '1h', issuer: 'courses4me-api', audience: 'courses4me', algorithm: 'HS256' }
  );
}

/** A structurally valid JWT signed with the right secret but for another issuer. */
function foreignTokenFor(user) {
  return jwt.sign({ id: user.id, role: user.role, tokenVersion: 0 }, process.env.JWT_SECRET, { expiresIn: '1h', issuer: 'some-other-app' });
}

/** Lets a test wait for fire-and-forget work (background emails, audit writes). */
const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 20));

module.exports = { createMockDb, tokenFor, foreignTokenFor, flushPromises };
