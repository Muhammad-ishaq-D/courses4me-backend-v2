/**
 * The jobs half of the in-memory database: vacancies, their requirements and
 * the applications against them.
 *
 * Returns undefined for anything it does not recognise, so the caller can
 * carry on down its own chain.
 */
function createJobRouter({ state, nextId, now }) {
  function seedListing(l) {
    const id = l.id || nextId('jobListings');
    state.seq.jobListings = Math.max(state.seq.jobListings, id);
    const { requirements, ...rest } = l;
    state.jobListings.push({
      id,
      title: l.title || 'Test Vacancy',
      company: l.company || 'Courses4Me',
      location: l.location || 'London',
      type: l.type || 'Full-time',
      category: l.category || 'SIA Training',
      career: l.career ?? '',
      salary: l.salary || '£12 per hour',
      description: l.description || 'What the role involves.',
      status: l.status || 'Active',
      is_featured: l.is_featured ?? 0,
      created_at: l.created_at ? new Date(l.created_at) : now(),
      updated_at: now(),
      ...rest,
      id
    });
    (requirements || []).forEach((value, position) => {
      state.jobRequirements.push({ id: nextId('jobRequirements'), job_listing_id: id, position, value });
    });
    return id;
  }

  function seedApplication(a) {
    const id = a.id || nextId('jobApplications');
    state.seq.jobApplications = Math.max(state.seq.jobApplications, id);
    state.jobApplications.push({
      id,
      application_reference: a.application_reference || `REF-TEST${String(id).padStart(3, '0')}`,
      job_listing_id: a.job_listing_id === undefined ? null : (a.job_listing_id === null ? null : Number(a.job_listing_id)),
      job_title: a.job_title || 'Test Vacancy',
      user_id: a.user_id === undefined || a.user_id === null ? null : Number(a.user_id),
      first_name: a.first_name || 'Test',
      last_name: a.last_name || 'Candidate',
      applicant_name: a.applicant_name || `${a.first_name || 'Test'} ${a.last_name || 'Candidate'}`,
      email: String(a.email || 'candidate@example.test').toLowerCase(),
      phone: a.phone || '07000000000',
      address: a.address || '1 Test Street',
      city: a.city || 'London',
      postcode: a.postcode || 'SW1A 1AA',
      license: a.license || 'SIA Licensed',
      experience: a.experience || '2 years',
      availability: a.availability || 'Immediately',
      cover: a.cover || 'Why I am a good fit.',
      cv_file: a.cv_file || 'cv_resume.pdf',
      status: a.status || 'Pending',
      created_at: a.created_at ? new Date(a.created_at) : now(),
      updated_at: now()
    });
    return id;
  }

  function filterListings(q, params) {
    let rows = [...state.jobListings];
    let i = 0;
    if (/category = \?/.test(q)) { const v = params[i++]; rows = rows.filter(l => l.category === v); }
    if (/type = \?/.test(q)) { const v = params[i++]; rows = rows.filter(l => l.type === v); }
    if (/status = \?/.test(q)) { const v = params[i++]; rows = rows.filter(l => l.status === v); }
    if (/title LIKE \?/.test(q)) {
      const needle = String(params[i]).replace(/%/g, '').toLowerCase();
      rows = rows.filter(l => [l.title, l.company, l.description].some(f => f && String(f).toLowerCase().includes(needle)));
    }
    return rows;
  }

  function route(q, params) {
    // ── vacancies ───────────────────────────────────────────────────────
    if (/FROM job_listings WHERE id = \? LIMIT 1/.test(q)) {
      const l = state.jobListings.find(x => x.id === Number(params[0]));
      return l ? [{ ...l }] : [];
    }
    if (/FROM job_listings WHERE id IN \(\?\)/.test(q)) {
      const ids = params[0].map(Number);
      return state.jobListings.filter(l => ids.includes(l.id)).map(l => ({ ...l }));
    }
    if (/FROM job_listings.* ORDER BY created_at DESC/.test(q)) {
      return filterListings(q, params)
        .sort((a, b) => b.created_at - a.created_at || b.id - a.id)
        .map(l => ({ ...l }));
    }
    if (/^INSERT INTO job_listings \(/.test(q)) {
      const cols = q.match(/^INSERT INTO job_listings \(([^)]+)\)/)[1].split(',').map(x => x.trim());
      const data = {}; cols.forEach((c, i) => { data[c] = params[i]; });
      return { insertId: seedListing({ ...data, id: undefined }), affectedRows: 1 };
    }
    if (/^UPDATE job_listings SET .* WHERE id = \?$/.test(q)) {
      const sets = q.match(/^UPDATE job_listings SET (.*) WHERE id = \?$/)[1].split(',').map(x => x.trim().split(' = ')[0]);
      const l = state.jobListings.find(x => x.id === Number(params[params.length - 1]));
      if (!l) return { affectedRows: 0 };
      sets.forEach((c, i) => { l[c] = params[i]; });
      l.updated_at = now();
      return { affectedRows: 1 };
    }
    if (/^DELETE FROM job_listings WHERE id = \?/.test(q)) {
      const id = Number(params[0]);
      const before = state.jobListings.length;
      state.jobListings = state.jobListings.filter(l => l.id !== id);
      const removed = before - state.jobListings.length;
      if (removed) {
        state.jobRequirements = state.jobRequirements.filter(r => r.job_listing_id !== id);
        // ON DELETE SET NULL: the applications survive the vacancy
        for (const a of state.jobApplications) if (a.job_listing_id === id) a.job_listing_id = null;
      }
      return { affectedRows: removed };
    }

    // ── requirements ────────────────────────────────────────────────────
    if (/FROM job_listing_requirements WHERE job_listing_id IN \(\?\)/.test(q)) {
      const ids = params[0].map(Number);
      return state.jobRequirements.filter(r => ids.includes(r.job_listing_id))
        .sort((a, b) => a.position - b.position || a.id - b.id)
        .map(r => ({ job_listing_id: r.job_listing_id, value: r.value }));
    }
    if (/^INSERT INTO job_listing_requirements/.test(q)) {
      for (let i = 0; i < params.length; i += 3) {
        state.jobRequirements.push({ id: nextId('jobRequirements'), job_listing_id: Number(params[i]), position: params[i + 1], value: params[i + 2] });
      }
      return { affectedRows: params.length / 3 };
    }
    if (/^DELETE FROM job_listing_requirements WHERE job_listing_id = \?/.test(q)) {
      state.jobRequirements = state.jobRequirements.filter(r => r.job_listing_id !== Number(params[0]));
      return { affectedRows: 1 };
    }

    // ── applications ────────────────────────────────────────────────────
    if (/FROM job_applications WHERE id = \? LIMIT 1/.test(q)) {
      const a = state.jobApplications.find(x => x.id === Number(params[0]));
      return a ? [{ ...a }] : [];
    }
    if (/FROM job_applications WHERE job_listing_id = \? AND user_id = \? LIMIT 1/.test(q)) {
      const a = state.jobApplications.find(x => x.job_listing_id === Number(params[0]) && x.user_id === Number(params[1]));
      return a ? [{ ...a }] : [];
    }
    if (/FROM job_applications WHERE job_listing_id = \? AND email = \? LIMIT 1/.test(q)) {
      const a = state.jobApplications.find(x => x.job_listing_id === Number(params[0]) && x.email === params[1]);
      return a ? [{ ...a }] : [];
    }
    if (/FROM job_applications WHERE user_id = \?( OR email = \?)? ORDER BY/.test(q)) {
      const userId = Number(params[0]);
      const email = params[1];
      return state.jobApplications
        .filter(a => a.user_id === userId || (email && a.email === email))
        .sort((a, b) => b.created_at - a.created_at || b.id - a.id)
        .map(a => ({ ...a }));
    }
    if (/FROM job_applications.* ORDER BY created_at DESC/.test(q)) {
      let rows = [...state.jobApplications];
      let i = 0;
      if (/status = \?/.test(q)) { const v = params[i++]; rows = rows.filter(a => a.status === v); }
      if (/first_name LIKE \?/.test(q)) {
        const needle = String(params[i]).replace(/%/g, '').toLowerCase();
        rows = rows.filter(a => [a.first_name, a.last_name, a.email, a.job_title]
          .some(f => f && String(f).toLowerCase().includes(needle)));
      }
      return rows.sort((a, b) => b.created_at - a.created_at || b.id - a.id).map(a => ({ ...a }));
    }
    if (/^INSERT INTO job_applications \(/.test(q)) {
      const cols = q.match(/^INSERT INTO job_applications \(([^)]+)\)/)[1].split(',').map(x => x.trim());
      const data = {}; cols.forEach((c, i) => { data[c] = params[i]; });
      if (state.jobApplications.some(a => a.application_reference === data.application_reference)) {
        const e = new Error("Duplicate entry for key 'uq_job_applications_reference'"); e.code = 'ER_DUP_ENTRY'; throw e;
      }
      return { insertId: seedApplication({ ...data, id: undefined }), affectedRows: 1 };
    }
    if (/^UPDATE job_applications SET status = \? WHERE id = \?/.test(q)) {
      const a = state.jobApplications.find(x => x.id === Number(params[1]));
      if (a) { a.status = params[0]; a.updated_at = now(); }
      return { affectedRows: a ? 1 : 0 };
    }

    return undefined;
  }

  return { route, seedListing, seedApplication };
}

module.exports = { createJobRouter };
