/**
 * The settings, notifications and dashboard half of the in-memory database.
 *
 * Kept beside mockDb so the SQL router there stays readable: mockDb owns the
 * record tables, this file owns the admin screens built on top of them.
 * Returns undefined for anything it does not recognise, so the caller can
 * carry on down its own chain.
 */
function createAdminRouter({ state, nextId, now }) {
  const monthKey = (d) => `${new Date(d).getUTCFullYear()}-${new Date(d).getUTCMonth() + 1}`;
  const paid = (b) => b.payment_status === 'Paid';
  const courseOf = (b) => state.courses.find(c => c.id === b.course_id);

  /** Groups bookings by calendar month into [{ year, month, ...totals }]. */
  function groupByMonth(rows, build) {
    const groups = new Map();
    for (const row of rows) {
      const date = new Date(row.created_at);
      const key = monthKey(date);
      if (!groups.has(key)) groups.set(key, { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, rows: [] });
      groups.get(key).rows.push(row);
    }
    return [...groups.values()]
      .sort((a, b) => a.year - b.year || a.month - b.month)
      .map(g => ({ year: g.year, month: g.month, ...build(g.rows) }));
  }

  /** Applies the `created_at >= ? AND created_at <= ?` filters of a query. */
  function inRange(rows, q, params) {
    let i = 0;
    let out = [...rows];
    if (/created_at >= \?/.test(q)) { const from = new Date(params[i++]); out = out.filter(r => new Date(r.created_at) >= from); }
    if (/created_at <= \?/.test(q)) { const to = new Date(params[i++]); out = out.filter(r => new Date(r.created_at) <= to); }
    return out;
  }

  return function routeAdmin(q, params) {
    // ── settings ────────────────────────────────────────────────────────
    if (/FROM settings ORDER BY id ASC LIMIT 1/.test(q)) {
      return state.settings ? [{ ...state.settings }] : [];
    }
    if (/^INSERT INTO settings/.test(q)) {
      state.settings = { id: 1, general: params[0], notifications: params[1], email_templates: params[2], created_at: now(), updated_at: now() };
      return { insertId: 1, affectedRows: 1 };
    }
    if (/^UPDATE settings SET .* WHERE id = \?$/.test(q)) {
      if (!state.settings) return { affectedRows: 0 };
      const cols = q.match(/^UPDATE settings SET (.*) WHERE id = \?$/)[1].split(',').map(x => x.trim().split(' = ')[0]);
      cols.forEach((c, i) => { state.settings[c] = params[i]; });
      state.settings.updated_at = now();
      return { affectedRows: 1 };
    }

    // ── notifications ───────────────────────────────────────────────────
    if (/FROM notifications WHERE id = \? LIMIT 1/.test(q)) {
      const n = state.notifications.find(x => x.id === Number(params[0]));
      return n ? [{ ...n }] : [];
    }
    if (/FROM notifications WHERE user_id = \? ORDER BY created_at DESC/.test(q)) {
      return state.notifications
        .filter(n => n.user_id === Number(params[0]))
        .sort((a, b) => b.created_at - a.created_at || b.id - a.id)
        .slice(0, params[1])
        .map(n => ({ ...n }));
    }
    if (/^SELECT COUNT\(\*\) AS total FROM notifications WHERE user_id = \? AND is_read = 0/.test(q)) {
      return [{ total: state.notifications.filter(n => n.user_id === Number(params[0]) && !n.is_read).length }];
    }
    if (/^INSERT INTO notifications/.test(q)) {
      for (let i = 0; i < params.length; i += 4) {
        state.notifications.push({
          id: nextId('notifications'), user_id: Number(params[i]), title: params[i + 1],
          message: params[i + 2], type: params[i + 3], is_read: 0, created_at: now()
        });
      }
      return { insertId: state.seq.notifications, affectedRows: params.length / 4 };
    }
    if (/^UPDATE notifications SET is_read = 1 WHERE id = \?/.test(q)) {
      const n = state.notifications.find(x => x.id === Number(params[0]));
      if (n) n.is_read = 1;
      return { affectedRows: n ? 1 : 0 };
    }
    if (/^UPDATE notifications SET is_read = 1 WHERE user_id = \? AND is_read = 0/.test(q)) {
      const unread = state.notifications.filter(n => n.user_id === Number(params[0]) && !n.is_read);
      unread.forEach(n => { n.is_read = 1; });
      return { affectedRows: unread.length };
    }

    // ── dashboard: headline figures ─────────────────────────────────────
    if (/^SELECT COUNT\(\*\) AS total, SUM\(status = 'Published'\) AS active FROM courses/.test(q)) {
      return [{ total: state.courses.length, active: state.courses.filter(c => c.status === 'Published').length }];
    }
    if (/^SELECT COUNT\(\*\) AS total FROM bookings/.test(q) && !/user_id/.test(q)) {
      return [{ total: inRange(state.bookings, q, params).length }];
    }
    if (/^SELECT COALESCE\(SUM\(total_amount\), 0\) AS total FROM bookings/.test(q) && /payment_status = 'Paid'/.test(q)) {
      const rows = inRange(state.bookings, q, params).filter(paid);
      return [{ total: rows.reduce((acc, b) => acc + Number(b.total_amount), 0) }];
    }

    // ── dashboard: charts ───────────────────────────────────────────────
    if (/COUNT\(\*\) AS enrollments/.test(q) && /FROM bookings WHERE created_at >= \?/.test(q)) {
      const rows = state.bookings.filter(b => new Date(b.created_at) >= new Date(params[0]));
      return groupByMonth(rows, (group) => ({
        enrollments: group.length,
        revenue: group.filter(paid).reduce((acc, b) => acc + Number(b.total_amount), 0)
      }));
    }
    if (/AS new_customers/.test(q)) {
      const rows = state.bookings.filter(b => new Date(b.created_at) >= new Date(params[0]));
      return groupByMonth(rows, (group) => {
        let fresh = 0;
        let returning = 0;
        for (const b of group) {
          const user = state.users.find(u => u.id === b.user_id);
          const isNew = user && monthKey(user.created_at) === monthKey(b.created_at);
          if (isNew) fresh += 1; else returning += 1;
        }
        return { new_customers: fresh, returning_customers: returning };
      });
    }
    if (/COALESCE\(SUM\(total_amount\), 0\) AS value/.test(q)) {
      const rows = state.bookings.filter(b => new Date(b.created_at) >= new Date(params[0]) && paid(b));
      return groupByMonth(rows, (group) => ({ value: group.reduce((acc, b) => acc + Number(b.total_amount), 0) }));
    }
    if (/SELECT c\.category, COUNT\(\*\) AS value/.test(q)) {
      const counts = {};
      for (const b of state.bookings) {
        const course = courseOf(b);
        if (!course) continue;
        counts[course.category] = (counts[course.category] || 0) + 1;
      }
      return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([category, value]) => ({ category, value }));
    }

    // ── dashboard: lists ────────────────────────────────────────────────
    if (/^SELECT title, status, updated_at FROM courses ORDER BY updated_at DESC/.test(q)) {
      return [...state.courses].sort((a, b) => b.updated_at - a.updated_at || b.id - a.id).slice(0, 3)
        .map(c => ({ title: c.title, status: c.status, updated_at: c.updated_at }));
    }
    if (/SELECT b\.customer_first_name, b\.customer_last_name, u\.name AS user_name/.test(q)) {
      return [...state.bookings].sort((a, b) => b.created_at - a.created_at || b.id - a.id).slice(0, 3)
        .map(b => ({
          customer_first_name: b.customer_first_name,
          customer_last_name: b.customer_last_name,
          user_name: state.users.find(u => u.id === b.user_id)?.name || null,
          created_at: b.created_at
        }));
    }
    if (/SELECT b\.customer_first_name, b\.customer_last_name, b\.total_amount/.test(q)) {
      const limit = params[params.length - 1];
      const rows = inRange(state.bookings.map(b => ({ ...b, created_at: b.created_at })), q.replace(/b\./g, ''), params);
      return rows.sort((a, b) => b.created_at - a.created_at || b.id - a.id).slice(0, limit).map(b => ({
        customer_first_name: b.customer_first_name,
        customer_last_name: b.customer_last_name,
        total_amount: b.total_amount,
        payment_status: b.payment_status,
        title: courseOf(b)?.title || null
      }));
    }
    if (/FROM course_location_dates d/.test(q) && /seats_left/.test(q)) {
      const threshold = params[0];
      const limit = params[1];
      return state.courseLocationDates
        .map(d => {
          const link = state.courseLocations.find(cl => cl.id === d.course_location_id);
          const course = link && state.courses.find(c => c.id === link.course_id);
          const location = link && state.locations.find(l => l.id === link.location_id);
          return course && location
            ? { title: course.title, location: location.name, start_date: d.start_date, seats_left: Math.max(0, d.available_seats - d.booked_seats) }
            : null;
        })
        .filter(r => r && r.seats_left <= threshold)
        .sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)))
        .slice(0, limit);
    }
    if (/FROM course_venue_schedules s/.test(q) && /seats_left/.test(q)) {
      const threshold = params[0];
      const limit = params[1];
      return state.courseSchedules
        .map(s => {
          const venue = state.courseVenues.find(v => v.id === s.course_venue_id);
          const course = venue && state.courses.find(c => c.id === venue.course_id);
          return course ? { title: course.title, location: venue.name, start_date: s.start_date, seats_left: s.seats_available } : null;
        })
        .filter(r => r && r.seats_left <= threshold)
        .sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)))
        .slice(0, limit);
    }
    if (/FROM courses WHERE status = 'Draft'/.test(q)) {
      return state.courses.filter(c => c.status === 'Draft').slice(0, params[0])
        .map(c => ({ id: c.id, title: c.title, instructor_name: c.instructor_name, instructor_photo: c.instructor_photo }));
    }
    if (/COUNT\(\*\) AS enrollments, COALESCE\(SUM\(b\.total_amount\), 0\) AS revenue/.test(q)) {
      const totals = new Map();
      for (const b of state.bookings.filter(paid)) {
        const course = courseOf(b);
        if (!course) continue;
        const entry = totals.get(course.id) || { id: course.id, title: course.title, enrollments: 0, revenue: 0 };
        entry.enrollments += 1;
        entry.revenue += Number(b.total_amount);
        totals.set(course.id, entry);
      }
      return [...totals.values()].sort((a, b) => b.revenue - a.revenue).slice(0, params[0]);
    }

    // ── weekly report ───────────────────────────────────────────────────
    if (/^SELECT COUNT\(\*\) AS total FROM users WHERE created_at >= \? AND role = 'customer'/.test(q)) {
      return [{ total: state.users.filter(u => u.role === 'customer' && new Date(u.created_at) >= new Date(params[0])).length }];
    }
    if (/SELECT c\.title, COUNT\(\*\) AS bookings/.test(q)) {
      const since = new Date(params[0]);
      const counts = new Map();
      for (const b of state.bookings.filter(x => new Date(x.created_at) >= since)) {
        const course = courseOf(b);
        if (!course) continue;
        counts.set(course.title, (counts.get(course.title) || 0) + 1);
      }
      return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 1).map(([title, bookings]) => ({ title, bookings }));
    }

    return undefined;
  };
}

module.exports = { createAdminRouter };
