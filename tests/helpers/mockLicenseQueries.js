/**
 * The licences half of the in-memory database: the licence record, its lists,
 * steps, fees, related courses and its own venues and sessions.
 *
 * Returns undefined for anything it does not recognise, so the caller can
 * carry on down its own chain.
 */
function createLicenseRouter({ state, nextId, now }) {
  function seedLicense(l) {
    const id = l.id || nextId('licenses');
    state.seq.licenses = Math.max(state.seq.licenses, id);
    const { highlights, learningPoints, requirements, applicationSteps, pricingBreakdown, relatedCourses, locations, pricing, instructor, ...rest } = l;
    state.licenses.push({
      id,
      title: l.title || 'Test Licence',
      license_type: l.license_type || 'Security Guard',
      category: l.category || 'SIA Training',
      subtitle: null,
      short_description: l.short_description || 'A short description of the licence.',
      full_description: l.full_description || 'Full description.',
      thumbnail: null,
      salary: null, duration: null, valid: null,
      experience: '5 Years', training_count: '12 Courses', rating: '4.9/5',
      renewal_info: null,
      base_price: l.base_price ?? 220,
      sale_price: null, original_price: null,
      instructor_name: null, instructor_title: null, instructor_bio: null, instructor_photo: null,
      status: l.status || 'Published',
      is_popular: l.is_popular ?? 0,
      icon: 'shield', icon_color: 'bg-blue-600',
      license_number: l.license_number || `SIA-1000000${id}`,
      holder_name: l.holder_name ?? null,
      email: null,
      license_authority: 'SIA (Security Industry Authority)',
      holder_id: `LH-10${id}`,
      expiry_date: '2029-01-01',
      created_at: l.created_at ? new Date(l.created_at) : now(),
      updated_at: now(),
      ...rest,
      id
    });
    return id;
  }

  function filterLicenses(q, params) {
    let rows = [...state.licenses];
    let i = 0;
    if (/category = \?/.test(q)) { const v = params[i++]; rows = rows.filter(l => l.category === v); }
    if (/status = \?/.test(q)) { const v = params[i++]; rows = rows.filter(l => l.status === v); }
    if (/title LIKE \?/.test(q)) {
      const needle = String(params[i]).replace(/%/g, '').toLowerCase(); i += 4;
      rows = rows.filter(l => [l.title, l.license_number, l.holder_name, l.license_type]
        .some(f => f && String(f).toLowerCase().includes(needle)));
    }
    return rows;
  }

  function route(q, params) {
    // ── the licence record ──────────────────────────────────────────────
    if (/^SELECT \* FROM licenses WHERE id = \? LIMIT 1/.test(q)) {
      const l = state.licenses.find(x => x.id === Number(params[0]));
      return l ? [{ ...l }] : [];
    }
    if (/^SELECT id, title, license_type.* FROM licenses WHERE id = \? LIMIT 1/.test(q)) {
      const l = state.licenses.find(x => x.id === Number(params[0]));
      return l ? [{ ...l }] : [];
    }
    if (/^SELECT id, title, category, thumbnail, status FROM licenses WHERE id = \? LIMIT 1/.test(q)) {
      const l = state.licenses.find(x => x.id === Number(params[0]));
      return l ? [{ id: l.id, title: l.title, category: l.category, thumbnail: l.thumbnail, status: l.status }] : [];
    }
    if (/^SELECT id, title, category, thumbnail, status FROM licenses WHERE id IN \(\?\)/.test(q)) {
      const ids = params[0].map(Number);
      return state.licenses.filter(l => ids.includes(l.id))
        .map(l => ({ id: l.id, title: l.title, category: l.category, thumbnail: l.thumbnail, status: l.status }));
    }
    if (/^SELECT COUNT\(\*\) AS total FROM licenses/.test(q)) {
      return [{ total: filterLicenses(q, params).length }];
    }
    if (/^SELECT id, title, license_type.* FROM licenses/.test(q) && /ORDER BY created_at DESC/.test(q)) {
      const rows = filterLicenses(q, params).sort((a, b) => b.created_at - a.created_at || b.id - a.id);
      const limit = params[params.length - 2];
      const offset = params[params.length - 1];
      return rows.slice(offset, offset + limit).map(l => ({ ...l }));
    }
    if (/^INSERT INTO licenses \(/.test(q)) {
      const cols = q.match(/^INSERT INTO licenses \(([^)]+)\)/)[1].split(',').map(x => x.trim());
      const data = {}; cols.forEach((c, i) => { data[c] = params[i]; });
      return { insertId: seedLicense({ ...data, id: undefined }), affectedRows: 1 };
    }
    if (/^UPDATE licenses SET .* WHERE id = \?$/.test(q)) {
      const sets = q.match(/^UPDATE licenses SET (.*) WHERE id = \?$/)[1].split(',').map(x => x.trim().split(' = ')[0]);
      const l = state.licenses.find(x => x.id === Number(params[params.length - 1]));
      if (!l) return { affectedRows: 0 };
      sets.forEach((c, i) => { l[c] = params[i]; });
      l.updated_at = now();
      return { affectedRows: 1 };
    }
    if (/^DELETE FROM licenses WHERE id = \?/.test(q)) {
      const id = Number(params[0]);
      const before = state.licenses.length;
      state.licenses = state.licenses.filter(l => l.id !== id);
      const removed = before - state.licenses.length;
      if (removed) {
        state.licenseListItems = state.licenseListItems.filter(x => x.license_id !== id);
        state.licenseSteps = state.licenseSteps.filter(x => x.license_id !== id);
        state.licensePricing = state.licensePricing.filter(x => x.license_id !== id);
        state.licenseRelatedCourses = state.licenseRelatedCourses.filter(x => x.license_id !== id);
        const venueIds = state.licenseVenues.filter(v => v.license_id === id).map(v => v.id);
        state.licenseVenues = state.licenseVenues.filter(v => v.license_id !== id);
        state.licenseSchedules = state.licenseSchedules.filter(s => !venueIds.includes(s.license_venue_id));
      }
      return { affectedRows: removed };
    }

    // ── display lists ───────────────────────────────────────────────────
    if (/FROM license_list_items WHERE license_id IN \(\?\)/.test(q)) {
      const ids = params[0].map(Number);
      return state.licenseListItems.filter(x => ids.includes(x.license_id))
        .sort((a, b) => a.type.localeCompare(b.type) || a.position - b.position || a.id - b.id)
        .map(x => ({ license_id: x.license_id, type: x.type, value: x.value }));
    }
    if (/^INSERT INTO license_list_items/.test(q)) {
      for (let i = 0; i < params.length; i += 4) {
        state.licenseListItems.push({ id: nextId('licenseListItems'), license_id: Number(params[i]), type: params[i + 1], position: params[i + 2], value: params[i + 3] });
      }
      return { affectedRows: params.length / 4 };
    }
    if (/^DELETE FROM license_list_items WHERE license_id = \? AND type IN \(\?\)/.test(q)) {
      const types = params[1];
      state.licenseListItems = state.licenseListItems.filter(x => !(x.license_id === Number(params[0]) && types.includes(x.type)));
      return { affectedRows: 1 };
    }

    // ── application steps ───────────────────────────────────────────────
    if (/FROM license_application_steps WHERE license_id IN \(\?\)/.test(q)) {
      const ids = params[0].map(Number);
      return state.licenseSteps.filter(x => ids.includes(x.license_id))
        .sort((a, b) => a.position - b.position || a.id - b.id).map(x => ({ ...x }));
    }
    if (/^INSERT INTO license_application_steps/.test(q)) {
      for (let i = 0; i < params.length; i += 4) {
        state.licenseSteps.push({ id: nextId('licenseSteps'), license_id: Number(params[i]), position: params[i + 1], title: params[i + 2], description: params[i + 3] });
      }
      return { affectedRows: params.length / 4 };
    }
    if (/^DELETE FROM license_application_steps WHERE license_id = \?/.test(q)) {
      state.licenseSteps = state.licenseSteps.filter(x => x.license_id !== Number(params[0]));
      return { affectedRows: 1 };
    }

    // ── fee table ───────────────────────────────────────────────────────
    if (/FROM license_pricing_breakdown WHERE license_id IN \(\?\)/.test(q)) {
      const ids = params[0].map(Number);
      return state.licensePricing.filter(x => ids.includes(x.license_id))
        .sort((a, b) => a.position - b.position || a.id - b.id).map(x => ({ ...x }));
    }
    if (/^INSERT INTO license_pricing_breakdown/.test(q)) {
      for (let i = 0; i < params.length; i += 4) {
        state.licensePricing.push({ id: nextId('licensePricing'), license_id: Number(params[i]), position: params[i + 1], label: params[i + 2], price: params[i + 3] });
      }
      return { affectedRows: params.length / 4 };
    }
    if (/^DELETE FROM license_pricing_breakdown WHERE license_id = \?/.test(q)) {
      state.licensePricing = state.licensePricing.filter(x => x.license_id !== Number(params[0]));
      return { affectedRows: 1 };
    }

    // ── related courses ─────────────────────────────────────────────────
    if (/FROM license_related_courses WHERE license_id IN \(\?\)/.test(q)) {
      const ids = params[0].map(Number);
      return state.licenseRelatedCourses.filter(x => ids.includes(x.license_id))
        .sort((a, b) => a.position - b.position || a.course_id - b.course_id)
        .map(x => ({ license_id: x.license_id, course_id: x.course_id }));
    }
    if (/^INSERT INTO license_related_courses/.test(q)) {
      for (let i = 0; i < params.length; i += 3) {
        state.licenseRelatedCourses.push({ license_id: Number(params[i]), course_id: Number(params[i + 1]), position: params[i + 2] });
      }
      return { affectedRows: params.length / 3 };
    }
    if (/^DELETE FROM license_related_courses WHERE license_id = \?/.test(q)) {
      state.licenseRelatedCourses = state.licenseRelatedCourses.filter(x => x.license_id !== Number(params[0]));
      return { affectedRows: 1 };
    }

    // ── venues and their sessions ───────────────────────────────────────
    if (/FROM license_venues WHERE license_id IN \(\?\)/.test(q)) {
      const ids = params[0].map(Number);
      return state.licenseVenues.filter(v => ids.includes(v.license_id))
        .sort((a, b) => a.license_id - b.license_id || a.position - b.position || a.id - b.id)
        .map(v => ({ ...v }));
    }
    if (/^INSERT INTO license_venues/.test(q)) {
      const id = nextId('licenseVenues');
      state.licenseVenues.push({ id, license_id: Number(params[0]), position: params[1], name: params[2] });
      return { insertId: id, affectedRows: 1 };
    }
    if (/^DELETE FROM license_venues WHERE license_id = \?/.test(q)) {
      const venueIds = state.licenseVenues.filter(v => v.license_id === Number(params[0])).map(v => v.id);
      state.licenseVenues = state.licenseVenues.filter(v => v.license_id !== Number(params[0]));
      state.licenseSchedules = state.licenseSchedules.filter(s => !venueIds.includes(s.license_venue_id));
      return { affectedRows: venueIds.length };
    }
    if (/FROM license_venue_schedules WHERE license_venue_id IN \(\?\)/.test(q)) {
      const ids = params[0].map(Number);
      return state.licenseSchedules.filter(s => ids.includes(s.license_venue_id))
        .sort((a, b) => a.license_venue_id - b.license_venue_id || a.position - b.position || a.id - b.id)
        .map(s => ({ ...s }));
    }
    if (/^INSERT INTO license_venue_schedules/.test(q)) {
      for (let i = 0; i < params.length; i += 8) {
        state.licenseSchedules.push({
          id: nextId('licenseSchedules'), license_venue_id: Number(params[i]), position: params[i + 1],
          time: params[i + 2], start_date: String(params[i + 3]).slice(0, 10), end_date: String(params[i + 4]).slice(0, 10),
          price: params[i + 5], seats_available: params[i + 6], availability_status: params[i + 7]
        });
      }
      return { affectedRows: params.length / 8 };
    }

    // ── seatService, for a booking on a licence session ─────────────────
    if (/FROM license_venue_schedules s JOIN license_venues v/.test(q)) {
      const venues = state.licenseVenues.filter(v => v.license_id === Number(params[0]));
      return state.licenseSchedules
        .filter(s => venues.some(v => v.id === s.license_venue_id))
        .map(s => {
          const v = venues.find(x => x.id === s.license_venue_id);
          return { id: s.id, time: s.time, start_date: s.start_date, end_date: s.end_date, price: s.price, seats_available: s.seats_available, location_name: v.name };
        });
    }
    if (/^UPDATE license_venue_schedules SET seats_available = seats_available - 1 WHERE id = \? AND seats_available > 0/.test(q)) {
      const s = state.licenseSchedules.find(x => x.id === Number(params[0]));
      if (!s || s.seats_available <= 0) return { affectedRows: 0 };
      s.seats_available -= 1;
      return { affectedRows: 1 };
    }
    if (/^UPDATE license_venue_schedules SET seats_available = seats_available \+ 1 WHERE id = \?/.test(q)) {
      const s = state.licenseSchedules.find(x => x.id === Number(params[0]));
      if (!s) return { affectedRows: 0 };
      s.seats_available += 1;
      return { affectedRows: 1 };
    }
    if (/^SELECT seats_available FROM license_venue_schedules WHERE id = \?/.test(q)) {
      const s = state.licenseSchedules.find(x => x.id === Number(params[0]));
      return s ? [{ seats_available: s.seats_available }] : [];
    }
    if (/^UPDATE license_venue_schedules SET availability_status = \? WHERE id = \?/.test(q)) {
      const s = state.licenseSchedules.find(x => x.id === Number(params[1]));
      if (s) s.availability_status = params[0];
      return { affectedRows: s ? 1 : 0 };
    }

    return undefined;
  }

  return { route, seedLicense };
}

module.exports = { createLicenseRouter };
