const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { createAdminRouter } = require('./mockAdminQueries');
const { createLicenseRouter } = require('./mockLicenseQueries');
const { createJobRouter } = require('./mockJobQueries');
const { createBlogRouter } = require('./mockBlogQueries');

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
function createMockDb({ users = [], courses = [], locations = [], courseLocations = [], bookings = [], licenses = [], jobListings = [], jobApplications = [], blogs = [] } = {}) {
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
    locations: [],
    locationFacilities: [],
    locationGallery: [],
    courseLocations: [],
    courseLocationDates: [],
    dateTimings: [],
    bookings: [],
    bookingExtensions: [],
    bookingReschedules: [],
    bookingAttendance: [],
    bookingCertificates: [],
    notifications: [],
    settings: null,
    licenses: [],
    licenseListItems: [],
    licenseSteps: [],
    licensePricing: [],
    licenseRelatedCourses: [],
    licenseVenues: [],
    licenseSchedules: [],
    jobListings: [],
    jobRequirements: [],
    jobApplications: [],
    reviews: [],
    blogs: [],
    blogBlocks: [],
    blogBlockItems: [],
    seq: {
      users: 0, activity: 0, devices: 0, resets: 0, audit: 0,
      courses: 0, courseListItems: 0, courseVenues: 0, courseSchedules: 0,
      locations: 0, locationGallery: 0, courseLocations: 0, courseLocationDates: 0,
      bookings: 0, bookingExtensions: 0, bookingReschedules: 0, bookingAttendance: 0, bookingCertificates: 0,
      notifications: 0,
      licenses: 0, licenseListItems: 0, licenseSteps: 0, licensePricing: 0, licenseVenues: 0, licenseSchedules: 0,
      jobListings: 0, jobRequirements: 0, jobApplications: 0,
      reviews: 0,
      blogs: 0, blogBlocks: 0, blogBlockItems: 0
    },
    tables: new Set([
      'users', 'user_activity_logs', 'user_devices', 'password_resets', 'audit_logs',
      'courses', 'course_list_items', 'course_venues', 'course_venue_schedules',
      'locations', 'location_facilities', 'location_gallery',
      'course_locations', 'course_location_dates', 'course_location_date_timings',
      'bookings', 'booking_extension_history', 'booking_reschedule_history',
      'booking_attendance', 'booking_certificates', 'settings', 'notifications',
      'licenses', 'license_list_items', 'license_application_steps', 'license_pricing_breakdown',
      'license_related_courses', 'license_venues', 'license_venue_schedules',
      'job_listings', 'job_listing_requirements', 'job_applications', 'reviews',
      'blogs', 'blog_blocks', 'blog_block_items'
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
      reference: String(id).padStart(6, "0"),
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

  function seedLocation(l) {
    const id = l.id || nextId('locations');
    state.seq.locations = Math.max(state.seq.locations, id);
    const { facilities, gallery, ...rest } = l;
    state.locations.push({
      id,
      name: l.name || 'Test Location',
      venue_name: l.venue_name ?? null,
      address_line1: l.address_line1 || '1 Test Street',
      address_line2: null,
      city: l.city || 'London',
      postcode: (l.postcode || 'SW1A 1AA').toUpperCase(),
      country: l.country || 'United Kingdom',
      maps_url: null, parking: l.parking ?? 0, parking_notes: null,
      accessibility: null, transport: null, main_image: null,
      local_market_overview: null, local_venues: null, surrounding_areas: null,
      status: l.status || 'Active',
      created_at: l.created_at ? new Date(l.created_at) : now(),
      updated_at: now(),
      ...rest,
      id
    });
    (facilities || []).forEach(f => state.locationFacilities.push({ location_id: id, facility: f }));
    (gallery || []).forEach((url, position) => state.locationGallery.push({ id: nextId('locationGallery'), location_id: id, position, url }));
    return id;
  }
  locations.forEach(seedLocation);

  function seedCourseLocation(cl) {
    const id = cl.id || nextId('courseLocations');
    state.seq.courseLocations = Math.max(state.seq.courseLocations, id);
    const { dates, ...rest } = cl;
    state.courseLocations.push({
      id,
      course_id: Number(cl.course_id),
      location_id: Number(cl.location_id),
      price: cl.price ?? 100,
      vat_included: cl.vat_included ?? 0,
      deposit_required: cl.deposit_required ?? 0,
      deposit_amount: cl.deposit_amount ?? 0,
      whats_included: cl.whats_included ?? null,
      status: cl.status || 'Active',
      created_at: now(), updated_at: now(),
      ...rest,
      id
    });
    (dates || []).forEach(d => {
      const dateId = nextId('courseLocationDates');
      state.courseLocationDates.push({
        id: dateId, course_location_id: id,
        start_date: d.start_date || '2026-11-01', end_date: d.end_date || '2026-11-02',
        start_time: d.start_time || '09:00:00', end_time: d.end_time || '17:00:00',
        available_seats: d.available_seats ?? 20, booked_seats: d.booked_seats ?? 0,
        timings_type: d.timings_type || 'same', created_at: now(), updated_at: now()
      });
    });
    return id;
  }
  courseLocations.forEach(seedCourseLocation);

  function seedBooking(b) {
    const id = b.id || nextId('bookings');
    state.seq.bookings = Math.max(state.seq.bookings, id);
    state.bookings.push({
      id,
      booking_reference: b.booking_reference || ('GL-TEST' + String(id).padStart(2, '0')),
      user_id: Number(b.user_id),
      course_id: Number(b.course_id),
      course_type: b.course_type || 'Course',
      package_name: b.package_name || 'Standard',
      session_location_name: b.session_location_name ?? 'London Centre',
      session_branch_name: b.session_branch_name ?? 'London Centre',
      session_schedule_id: b.session_schedule_id ?? null,
      session_schedule_source: b.session_schedule_source ?? null,
      session_start_date: b.session_start_date ?? '2027-01-04 09:00:00',
      session_end_date: b.session_end_date ?? '2027-01-06 17:00:00',
      session_time: b.session_time ?? '09:00 - 17:00',
      session_price: b.session_price ?? 200,
      customer_first_name: b.customer_first_name || 'Test',
      customer_last_name: b.customer_last_name || 'Student',
      customer_email: b.customer_email || 'student@example.test',
      customer_phone: b.customer_phone || '07000000000',
      customer_dob: b.customer_dob ?? null,
      billing_postcode: 'SW1A 1AA', billing_line1: '1 Test Street', billing_line2: null, billing_city: 'London',
      option_easy_apply: b.option_easy_apply ?? 0,
      additional_info: b.additional_info ?? null,
      total_amount: b.total_amount ?? 200,
      currency: 'GBP',
      payment_method: b.payment_method || 'card',
      payment_status: b.payment_status || 'Pending',
      stripe_session_id: b.stripe_session_id ?? null,
      payment_intent_id: b.payment_intent_id ?? null,
      status: b.status || 'PENDING',
      lifecycle_status: b.lifecycle_status || 'Upcoming',
      original_end_date: null,
      progress: b.progress ?? 0,
      refund_status: b.refund_status || 'None',
      refund_reason: null, refund_requested_at: null, refund_processed_at: null,
      refund_admin_notes: null, refund_id: null, refund_proof_url: null,
      pending_reschedule_start_date: b.pending_reschedule_start_date ?? null,
      pending_reschedule_end_date: b.pending_reschedule_end_date ?? null,
      pending_reschedule_reason: null, pending_reschedule_status: b.pending_reschedule_status ?? null,
      pending_reschedule_created_at: null,
      booking_date: now(),
      created_at: b.created_at ? new Date(b.created_at) : now(),
      updated_at: now()
    });
    return id;
  }
  bookings.forEach(seedBooking);

  // Handles the SQL emitted by bookingModel / bookingService / seatService.
  function routeBookings(q, params) {
    if (/FROM bookings WHERE id = \? LIMIT 1/.test(q)) {
      const b = state.bookings.find(x => x.id === Number(params[0]));
      return b ? [{ ...b }] : [];
    }
    if (/FROM bookings WHERE booking_reference = \? LIMIT 1/.test(q)) {
      const b = state.bookings.find(x => x.booking_reference === params[0]);
      return b ? [{ ...b }] : [];
    }
    if (/FROM bookings WHERE user_id = \? AND course_id = \? AND status IN \('PENDING','PAID'\) LIMIT 1/.test(q)) {
      const b = state.bookings.find(x => x.user_id === Number(params[0]) && x.course_id === Number(params[1]) && ['PENDING', 'PAID'].includes(x.status));
      return b ? [{ ...b }] : [];
    }
    if (/FROM bookings WHERE user_id = \? AND course_id = \? ORDER BY/.test(q)) {
      return state.bookings.filter(x => x.user_id === Number(params[0]) && x.course_id === Number(params[1]))
        .sort((a, b) => b.created_at - a.created_at || b.id - a.id).map(x => ({ ...x }));
    }
    if (/FROM bookings WHERE user_id = \? ORDER BY/.test(q)) {
      return state.bookings.filter(x => x.user_id === Number(params[0]))
        .sort((a, b) => b.created_at - a.created_at || b.id - a.id).map(x => ({ ...x }));
    }
    if (/FROM bookings WHERE status = 'PENDING' AND created_at < UTC_TIMESTAMP\(\) - INTERVAL \? MINUTE/.test(q)) {
      const cutoff = Date.now() - params[0] * 60000;
      return state.bookings.filter(x => x.status === 'PENDING' && x.created_at.getTime() < cutoff).map(x => ({ ...x }));
    }
    if (/^SELECT user_id, COUNT\(\*\) AS bookings/.test(q)) {
      const ids = params[0].map(Number);
      const map = {};
      for (const b of state.bookings) {
        if (!ids.includes(b.user_id)) continue;
        map[b.user_id] = map[b.user_id] || { user_id: b.user_id, bookings: 0, spent: 0 };
        map[b.user_id].bookings += 1;
        if (b.payment_status === 'Paid') map[b.user_id].spent += Number(b.total_amount);
      }
      return Object.values(map);
    }
    if (/^SELECT COUNT\(\*\) AS total FROM bookings WHERE user_id = \?/.test(q)) {
      return [{ total: state.bookings.filter(b => b.user_id === Number(params[0])).length }];
    }
    if (/^SELECT 1 FROM bookings WHERE LOWER\(customer_email\)/.test(q)) {
      return state.bookings.filter(b => b.customer_email.toLowerCase() === params[0]).map(() => ({ 1: 1 }));
    }
    if (/FROM bookings( WHERE .*)? ORDER BY created_at DESC/.test(q)) {
      let rows = [...state.bookings];
      let i = 0;
      if (/status = \?/.test(q)) { const v = params[i++]; rows = rows.filter(b => b.status === v); }
      if (/refund_status = 'Requested'/.test(q)) rows = rows.filter(b => b.refund_status === 'Requested');
      if (/payment_status = \?/.test(q)) { const v = params[i++]; rows = rows.filter(b => b.payment_status === v); }
      if (/created_at >= \?/.test(q)) { const v = new Date(String(params[i++]).replace(' ', 'T') + 'Z'); rows = rows.filter(b => b.created_at >= v); }
      if (/created_at <= \?/.test(q)) { const v = new Date(String(params[i++]).replace(' ', 'T') + 'Z'); rows = rows.filter(b => b.created_at <= v); }
      return rows.sort((a, b) => b.created_at - a.created_at || b.id - a.id).map(b => ({ ...b }));
    }
    if (/^INSERT INTO bookings \(/.test(q)) {
      const cols = q.match(/^INSERT INTO bookings \(([^)]+)\)/)[1].split(',').map(x => x.trim());
      const data = {}; cols.forEach((c, i) => { data[c] = params[i]; });
      if (state.bookings.some(b => b.booking_reference === data.booking_reference)) {
        const e = new Error("Duplicate entry for key 'uq_bookings_reference'"); e.code = 'ER_DUP_ENTRY'; throw e;
      }
      return { insertId: seedBooking({ ...data, id: undefined }), affectedRows: 1 };
    }
    if (/^UPDATE bookings SET .* WHERE id = \?$/.test(q)) {
      const sets = q.match(/^UPDATE bookings SET (.*) WHERE id = \?$/)[1].split(',').map(x => x.trim().split(' = ')[0]);
      const b = state.bookings.find(x => x.id === Number(params[params.length - 1]));
      if (!b) return { affectedRows: 0 };
      sets.forEach((c, i) => { b[c] = params[i]; });
      b.updated_at = now();
      return { affectedRows: 1 };
    }
    if (/^DELETE FROM bookings WHERE id = \?/.test(q)) {
      const before = state.bookings.length;
      state.bookings = state.bookings.filter(b => b.id !== Number(params[0]));
      return { affectedRows: before - state.bookings.length };
    }
    if (/^DELETE FROM bookings WHERE user_id IN \(\?\)/.test(q)) {
      const ids = params[0].map(Number);
      const before = state.bookings.length;
      state.bookings = state.bookings.filter(b => !ids.includes(b.user_id));
      return { affectedRows: before - state.bookings.length };
    }

    // history and child rows
    if (/^INSERT INTO booking_extension_history/.test(q)) {
      state.bookingExtensions.push({ id: nextId('bookingExtensions'), booking_id: Number(params[0]), previous_end_date: params[1], new_end_date: params[2], reason: params[3], created_at: now() });
      return { insertId: state.seq.bookingExtensions, affectedRows: 1 };
    }
    if (/^INSERT INTO booking_reschedule_history/.test(q)) {
      state.bookingReschedules.push({ id: nextId('bookingReschedules'), booking_id: Number(params[0]), previous_start_date: params[1], new_start_date: params[2], previous_end_date: params[3], new_end_date: params[4], reason: params[5], created_at: now() });
      return { insertId: state.seq.bookingReschedules, affectedRows: 1 };
    }
    if (/^SELECT COUNT\(\*\) AS total FROM booking_reschedule_history WHERE booking_id = \?/.test(q)) {
      return [{ total: state.bookingReschedules.filter(r => r.booking_id === Number(params[0])).length }];
    }
    if (/FROM booking_extension_history WHERE booking_id IN \(\?\)/.test(q)) {
      const ids = params[0].map(Number);
      return state.bookingExtensions.filter(r => ids.includes(r.booking_id)).map(r => ({ ...r }));
    }
    if (/FROM booking_reschedule_history WHERE booking_id IN \(\?\)/.test(q)) {
      const ids = params[0].map(Number);
      return state.bookingReschedules.filter(r => ids.includes(r.booking_id)).map(r => ({ ...r }));
    }
    if (/FROM booking_attendance WHERE booking_id IN \(\?\)/.test(q)) {
      const ids = params[0].map(Number);
      return state.bookingAttendance.filter(r => ids.includes(r.booking_id)).map(r => ({ ...r }));
    }
    if (/FROM booking_certificates WHERE booking_id IN \(\?\)/.test(q)) {
      const ids = params[0].map(Number);
      return state.bookingCertificates.filter(r => ids.includes(r.booking_id)).map(r => ({ ...r }));
    }

    // seatService
    if (/^UPDATE course_location_dates SET booked_seats = booked_seats \+ 1 WHERE id = \? AND booked_seats < available_seats/.test(q)) {
      const d = state.courseLocationDates.find(x => x.id === Number(params[0]));
      if (!d || d.booked_seats >= d.available_seats) return { affectedRows: 0 };
      d.booked_seats += 1;
      return { affectedRows: 1 };
    }
    if (/^UPDATE course_location_dates SET booked_seats = GREATEST\(booked_seats - 1, 0\) WHERE id = \?/.test(q)) {
      const d = state.courseLocationDates.find(x => x.id === Number(params[0]));
      if (!d) return { affectedRows: 0 };
      d.booked_seats = Math.max(0, d.booked_seats - 1);
      return { affectedRows: 1 };
    }
    if (/^SELECT available_seats, booked_seats FROM course_location_dates WHERE id = \?/.test(q)) {
      const d = state.courseLocationDates.find(x => x.id === Number(params[0]));
      return d ? [{ available_seats: d.available_seats, booked_seats: d.booked_seats }] : [];
    }
    if (/^UPDATE course_venue_schedules SET seats_available = seats_available - 1 WHERE id = \? AND seats_available > 0/.test(q)) {
      const sch = state.courseSchedules.find(x => x.id === Number(params[0]));
      if (!sch || sch.seats_available <= 0) return { affectedRows: 0 };
      sch.seats_available -= 1;
      return { affectedRows: 1 };
    }
    if (/^UPDATE course_venue_schedules SET seats_available = seats_available \+ 1 WHERE id = \?/.test(q)) {
      const sch = state.courseSchedules.find(x => x.id === Number(params[0]));
      if (!sch) return { affectedRows: 0 };
      sch.seats_available += 1;
      return { affectedRows: 1 };
    }
    if (/^SELECT seats_available FROM course_venue_schedules WHERE id = \?/.test(q)) {
      const sch = state.courseSchedules.find(x => x.id === Number(params[0]));
      return sch ? [{ seats_available: sch.seats_available }] : [];
    }
    if (/^UPDATE course_venue_schedules SET availability_status = \? WHERE id = \?/.test(q)) {
      const sch = state.courseSchedules.find(x => x.id === Number(params[1]));
      if (sch) sch.availability_status = params[0];
      return { affectedRows: sch ? 1 : 0 };
    }
    if (/FROM course_location_dates d JOIN course_locations cl/.test(q)) {
      const d = state.courseLocationDates.find(x => x.id === Number(params[0]));
      if (!d) return [];
      const cl = state.courseLocations.find(x => x.id === d.course_location_id);
      if (!cl) return [];
      const loc = state.locations.find(x => x.id === cl.location_id);
      return [{
        id: d.id, course_location_id: d.course_location_id, start_date: d.start_date, end_date: d.end_date,
        start_time: d.start_time, end_time: d.end_time, available_seats: d.available_seats,
        booked_seats: d.booked_seats, timings_type: d.timings_type,
        course_id: cl.course_id, price: cl.price, location_id: cl.location_id, location_name: loc ? loc.name : null
      }];
    }
    if (/FROM course_venue_schedules s JOIN course_venues v/.test(q)) {
      const venues = state.courseVenues.filter(v => v.course_id === Number(params[0]));
      return state.courseSchedules
        .filter(sch => venues.some(v => v.id === sch.course_venue_id))
        .map(sch => {
          const v = venues.find(x => x.id === sch.course_venue_id);
          return { id: sch.id, time: sch.time, start_date: sch.start_date, end_date: sch.end_date, price: sch.price, seats_available: sch.seats_available, location_name: v.name };
        });
    }

    // bookingService: users and courses for a set of bookings
    if (/^SELECT id, name, email, role, status FROM users WHERE id IN \(\?\)/.test(q)) {
      const ids = params[0].map(Number);
      return state.users.filter(u => ids.includes(u.id)).map(u => ({ id: u.id, name: u.name, email: u.email, role: u.role, status: u.status }));
    }
    if (/^SELECT id, title, category, thumbnail, status, base_price.* FROM courses WHERE id = \? LIMIT 1/.test(q)) {
      const c = state.courses.find(x => x.id === Number(params[0]));
      return c ? [{ ...c }] : [];
    }
    if (/^SELECT id, title, category, thumbnail, status, base_price.* FROM courses WHERE id IN \(\?\)/.test(q)) {
      const ids = params[0].map(Number);
      return state.courses.filter(c => ids.includes(c.id)).map(c => ({ ...c }));
    }
    return undefined;
  }

  // Handles the SQL emitted by locationModel / courseLocationModel.
  function routeLocations(q, params) {
    // ── locations ───────────────────────────────────────────────────────
    if (/^SELECT id, name, venue_name.* FROM locations WHERE id = \? LIMIT 1/.test(q)) {
      const l = state.locations.find(x => x.id === Number(params[0]));
      return l ? [{ ...l }] : [];
    }
    if (/^SELECT COUNT\(\*\) AS total FROM locations/.test(q)) {
      return [{ total: filterLocations(q, params).length }];
    }
    if (/^SELECT id, name, venue_name.* FROM locations.* ORDER BY created_at DESC/.test(q)) {
      let rows = filterLocations(q, params);
      rows.sort((a, b) => b.created_at - a.created_at || b.id - a.id);
      const limit = params[params.length - 2], offset = params[params.length - 1];
      return rows.slice(offset, offset + limit).map(l => ({ ...l }));
    }
    if (/FROM locations WHERE id IN \(\?\)/.test(q)) {
      const ids = params[0].map(Number);
      return state.locations.filter(l => ids.includes(l.id)).map(l => ({ ...l }));
    }
    if (/^SELECT location_id, facility FROM location_facilities WHERE location_id IN \(\?\)/.test(q)) {
      const ids = params[0].map(Number);
      return state.locationFacilities.filter(f => ids.includes(f.location_id)).sort((a, b) => a.facility.localeCompare(b.facility));
    }
    if (/^SELECT location_id, url FROM location_gallery WHERE location_id IN \(\?\)/.test(q)) {
      const ids = params[0].map(Number);
      return state.locationGallery.filter(g => ids.includes(g.location_id))
        .sort((a, b) => a.location_id - b.location_id || a.position - b.position || a.id - b.id);
    }
    if (/^INSERT INTO locations \(/.test(q)) {
      const cols = q.match(/^INSERT INTO locations \(([^)]+)\)/)[1].split(',').map(x => x.trim());
      const data = {}; cols.forEach((c, i) => { data[c] = params[i]; });
      return { insertId: seedLocation({ ...data, id: undefined }), affectedRows: 1 };
    }
    if (/^UPDATE locations SET status = \? WHERE id = \?/.test(q)) {
      const l = state.locations.find(x => x.id === Number(params[1]));
      if (l) l.status = params[0];
      return { affectedRows: l ? 1 : 0 };
    }
    if (/^UPDATE locations SET .* WHERE id = \?$/.test(q)) {
      const sets = q.match(/^UPDATE locations SET (.*) WHERE id = \?$/)[1].split(',').map(x => x.trim().split(' = ')[0]);
      const l = state.locations.find(x => x.id === Number(params[params.length - 1]));
      if (!l) return { affectedRows: 0 };
      sets.forEach((c, i) => { l[c] = params[i]; });
      l.updated_at = now();
      return { affectedRows: 1 };
    }
    if (/^DELETE FROM location_facilities WHERE location_id = \?/.test(q)) {
      state.locationFacilities = state.locationFacilities.filter(f => f.location_id !== Number(params[0]));
      return { affectedRows: 1 };
    }
    if (/^INSERT INTO location_facilities/.test(q)) {
      for (let i = 0; i < params.length; i += 2) state.locationFacilities.push({ location_id: Number(params[i]), facility: params[i + 1] });
      return { affectedRows: params.length / 2 };
    }
    if (/^DELETE FROM location_gallery WHERE location_id = \?/.test(q)) {
      state.locationGallery = state.locationGallery.filter(g => g.location_id !== Number(params[0]));
      return { affectedRows: 1 };
    }
    if (/^INSERT INTO location_gallery/.test(q)) {
      for (let i = 0; i < params.length; i += 3) {
        state.locationGallery.push({ id: nextId('locationGallery'), location_id: Number(params[i]), position: params[i + 1], url: params[i + 2] });
      }
      return { affectedRows: params.length / 3 };
    }

    // ── course_locations ────────────────────────────────────────────────
    if (/SELECT cl\.location_id, COUNT\(\*\) AS total/.test(q)) {
      const ids = params[0].map(Number);
      const counts = {};
      for (const cl of state.courseLocations) {
        if (!ids.includes(cl.location_id) || cl.status !== 'Active') continue;
        const course = state.courses.find(c => c.id === cl.course_id);
        if (!course || course.status !== 'Published') continue;
        counts[cl.location_id] = (counts[cl.location_id] || 0) + 1;
      }
      return Object.entries(counts).map(([location_id, total]) => ({ location_id: Number(location_id), total }));
    }
    if (/^SELECT COUNT\(\*\) AS total FROM course_locations WHERE location_id = \?/.test(q)) {
      return [{ total: state.courseLocations.filter(cl => cl.location_id === Number(params[0])).length }];
    }
    if (/FROM course_locations cl WHERE cl\.id = \? LIMIT 1/.test(q)) {
      const cl = state.courseLocations.find(x => x.id === Number(params[0]));
      return cl ? [{ ...cl }] : [];
    }
    if (/FROM course_locations cl WHERE cl\.course_id = \? AND cl\.location_id = \? LIMIT 1/.test(q)) {
      const cl = state.courseLocations.find(x => x.course_id === Number(params[0]) && x.location_id === Number(params[1]));
      return cl ? [{ id: cl.id }] : [];
    }
    // courseSessionService: dates of active links, excluding disabled locations
    if (/FROM course_locations cl JOIN course_location_dates d/.test(q)) {
      const ids = params[0].map(Number);
      const checksLocation = /JOIN locations l/.test(q);
      return state.courseLocations
        .filter(cl => ids.includes(cl.course_id) && cl.status === 'Active' &&
          (!checksLocation || state.locations.some(l => l.id === cl.location_id && l.status === 'Active')))
        .flatMap(cl => state.courseLocationDates.filter(d => d.course_location_id === cl.id)
          .map(d => ({
            course_id: cl.course_id, id: d.id, start_date: d.start_date, end_date: d.end_date,
            available_seats: d.available_seats, booked_seats: d.booked_seats
          })))
        .sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)) || a.id - b.id);
    }
    if (/FROM course_locations cl JOIN courses c/.test(q)) {
      return state.courseLocations
        .filter(cl => cl.status === 'Active' && state.courses.find(c => c.id === cl.course_id && c.status === 'Published'))
        .sort((a, b) => a.id - b.id).map(cl => ({ ...cl }));
    }
    if (/FROM course_locations cl WHERE cl\.course_id = \?/.test(q)) {
      let rows = state.courseLocations.filter(cl => cl.course_id === Number(params[0]));
      if (/cl\.status = 'Active'/.test(q)) {
        rows = rows.filter(cl => cl.status === 'Active' && state.locations.find(l => l.id === cl.location_id && l.status === 'Active'));
      }
      return rows.sort((a, b) => a.id - b.id).map(cl => ({ ...cl }));
    }
    if (/FROM course_locations cl WHERE cl\.location_id = \?/.test(q)) {
      return state.courseLocations.filter(cl => cl.location_id === Number(params[0])).sort((a, b) => a.id - b.id).map(cl => ({ ...cl }));
    }
    if (/^INSERT INTO course_locations \(/.test(q)) {
      const cols = q.match(/^INSERT INTO course_locations \(([^)]+)\)/)[1].split(',').map(x => x.trim());
      const data = {}; cols.forEach((c, i) => { data[c] = params[i]; });
      if (state.courseLocations.some(cl => cl.course_id === Number(data.course_id) && cl.location_id === Number(data.location_id))) {
        const e = new Error('Duplicate entry'); e.code = 'ER_DUP_ENTRY'; throw e;
      }
      if (!state.courses.find(c => c.id === Number(data.course_id))) {
        const e = new Error('No referenced row'); e.code = 'ER_NO_REFERENCED_ROW_2'; throw e;
      }
      return { insertId: seedCourseLocation({ ...data, id: undefined }), affectedRows: 1 };
    }
    if (/^UPDATE course_locations SET .* WHERE id = \?$/.test(q)) {
      const sets = q.match(/^UPDATE course_locations SET (.*) WHERE id = \?$/)[1].split(',').map(x => x.trim().split(' = ')[0]);
      const cl = state.courseLocations.find(x => x.id === Number(params[params.length - 1]));
      if (!cl) return { affectedRows: 0 };
      sets.forEach((c, i) => { cl[c] = params[i]; });
      cl.updated_at = now();
      return { affectedRows: 1 };
    }
    if (/^DELETE FROM course_locations WHERE id = \?/.test(q)) {
      const id = Number(params[0]);
      const before = state.courseLocations.length;
      state.courseLocations = state.courseLocations.filter(cl => cl.id !== id);
      const dateIds = state.courseLocationDates.filter(d => d.course_location_id === id).map(d => d.id);
      state.courseLocationDates = state.courseLocationDates.filter(d => d.course_location_id !== id);
      state.dateTimings = state.dateTimings.filter(t => !dateIds.includes(t.course_location_date_id));
      return { affectedRows: before - state.courseLocations.length };
    }

    // ── course_location_dates ───────────────────────────────────────────
    if (/FROM course_location_dates WHERE course_location_id IN \(\?\)/.test(q)) {
      const ids = params[0].map(Number);
      return state.courseLocationDates.filter(d => ids.includes(d.course_location_id))
        .sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)) || a.id - b.id)
        .map(d => ({ ...d }));
    }
    if (/FROM course_location_dates WHERE id = \? LIMIT 1/.test(q)) {
      const d = state.courseLocationDates.find(x => x.id === Number(params[0]));
      return d ? [{ ...d }] : [];
    }
    if (/FROM course_location_date_timings WHERE course_location_date_id IN \(\?\)/.test(q)) {
      const ids = params[0].map(Number);
      return state.dateTimings.filter(t => ids.includes(t.course_location_date_id)).map(t => ({ ...t }));
    }
    if (/FROM course_location_date_timings WHERE course_location_date_id = \?/.test(q) && /^SELECT/.test(q)) {
      return state.dateTimings.filter(t => t.course_location_date_id === Number(params[0])).map(t => ({ ...t }));
    }
    if (/^INSERT INTO course_location_dates/.test(q)) {
      const [course_location_id, start_date, end_date, start_time, end_time, available_seats, booked_seats, timings_type] = params;
      const id = nextId('courseLocationDates');
      state.courseLocationDates.push({
        id, course_location_id: Number(course_location_id),
        start_date: String(start_date).slice(0, 10), end_date: String(end_date).slice(0, 10),
        start_time, end_time,
        available_seats: Number(available_seats), booked_seats: Number(booked_seats), timings_type,
        created_at: now(), updated_at: now()
      });
      return { insertId: id, affectedRows: 1 };
    }
    if (/^UPDATE course_location_dates SET .* WHERE id = \?$/.test(q)) {
      const sets = q.match(/^UPDATE course_location_dates SET (.*) WHERE id = \?$/)[1].split(',').map(x => x.trim().split(' = ')[0]);
      const d = state.courseLocationDates.find(x => x.id === Number(params[params.length - 1]));
      if (!d) return { affectedRows: 0 };
      sets.forEach((c, i) => { d[c] = params[i]; });
      d.updated_at = now();
      return { affectedRows: 1 };
    }
    if (/^DELETE FROM course_location_dates WHERE course_location_id = \? AND id NOT IN \(\?\)/.test(q)) {
      const keep = params[1].map(Number);
      const removed = state.courseLocationDates.filter(d => d.course_location_id === Number(params[0]) && !keep.includes(d.id)).map(d => d.id);
      state.courseLocationDates = state.courseLocationDates.filter(d => !removed.includes(d.id));
      state.dateTimings = state.dateTimings.filter(t => !removed.includes(t.course_location_date_id));
      return { affectedRows: removed.length };
    }
    if (/^DELETE FROM course_location_dates WHERE course_location_id = \?/.test(q)) {
      const removed = state.courseLocationDates.filter(d => d.course_location_id === Number(params[0])).map(d => d.id);
      state.courseLocationDates = state.courseLocationDates.filter(d => !removed.includes(d.id));
      state.dateTimings = state.dateTimings.filter(t => !removed.includes(t.course_location_date_id));
      return { affectedRows: removed.length };
    }
    if (/^DELETE FROM course_location_dates WHERE id = \?/.test(q)) {
      const id = Number(params[0]);
      const before = state.courseLocationDates.length;
      state.courseLocationDates = state.courseLocationDates.filter(d => d.id !== id);
      state.dateTimings = state.dateTimings.filter(t => t.course_location_date_id !== id);
      return { affectedRows: before - state.courseLocationDates.length };
    }
    if (/^DELETE FROM course_location_date_timings WHERE course_location_date_id = \?/.test(q)) {
      state.dateTimings = state.dateTimings.filter(t => t.course_location_date_id !== Number(params[0]));
      return { affectedRows: 1 };
    }
    if (/^INSERT INTO course_location_date_timings/.test(q)) {
      for (let i = 0; i < params.length; i += 5) {
        state.dateTimings.push({
          course_location_date_id: Number(params[i]), day: params[i + 1],
          is_off: params[i + 2], start_time: params[i + 3], end_time: params[i + 4]
        });
      }
      return { affectedRows: params.length / 5 };
    }
    return undefined;
  }

  function filterLocations(q, params) {
    let rows = [...state.locations];
    let i = 0;
    if (/status = \?/.test(q)) { const v = params[i++]; rows = rows.filter(l => l.status === v); }
    if (/name LIKE \?/.test(q)) {
      const needle = String(params[i]).replace(/%/g, '').toLowerCase(); i += 4;
      rows = rows.filter(l => [l.name, l.city, l.postcode, l.venue_name].some(f => f && String(f).toLowerCase().includes(needle)));
    }
    return rows;
  }

  // Handles the SQL emitted by courseModel / courseSessionService / licenseLookupService.
  function routeCourses(q, params) {
    // reads
    if (/^SELECT id, (reference, )?title, category.* FROM courses WHERE id = \? LIMIT 1/.test(q)) {
      const c = state.courses.find(x => x.id === Number(params[0]));
      return c ? [{ ...c }] : [];
    }
    if (/FROM courses WHERE id IN \(\?\)/.test(q)) {
      const ids = params[0].map(Number);
      return state.courses.filter(c => ids.includes(c.id)).map(c => ({ ...c }));
    }
    if (/^SELECT id, title, category, duration, thumbnail.* FROM courses WHERE id IN \(\?\)/.test(q)) {
      const ids = params[0].map(Number);
      return state.courses.filter(c => ids.includes(c.id)).map(c => ({ ...c }));
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

  const routeAdmin = createAdminRouter({ state, nextId, now });
  const licenseRouter = createLicenseRouter({ state, nextId, now });
  licenses.forEach(licenseRouter.seedLicense);
  const jobRouter = createJobRouter({ state, nextId, now });
  jobListings.forEach(jobRouter.seedListing);
  jobApplications.forEach(jobRouter.seedApplication);
  const blogRouter = createBlogRouter({ state, nextId, now });
  blogs.forEach(blogRouter.seedBlog);

  function route(sql, params = []) {
    const q = sql.replace(/\s+/g, ' ').trim();
    state.log.push({ sql: q, params });

    // ── settings, notifications and the admin dashboard ───────────────────
    const admin = routeAdmin(q, params);
    if (admin !== undefined) return admin;

    // ── licences ──────────────────────────────────────────────────────────
    if (/\blicense/.test(q)) {
      const handled = licenseRouter.route(q, params);
      if (handled !== undefined) return handled;
    }

    // ── jobs ──────────────────────────────────────────────────────────────
    if (/\bjob_/.test(q)) {
      const handled = jobRouter.route(q, params);
      if (handled !== undefined) return handled;
    }

    // ── blog ──────────────────────────────────────────────────────────────
    if (/\bblogs?\b|\bblog_/.test(q)) {
      const handled = blogRouter.route(q, params);
      if (handled !== undefined) return handled;
    }

    // ── reviews ───────────────────────────────────────────────────────────
    if (/FROM reviews WHERE user_id = \? AND course_id = \? AND course_type = \? LIMIT 1/.test(q)) {
      const r = state.reviews.find(x => x.user_id === Number(params[0]) && x.course_id === Number(params[1]) && x.course_type === params[2]);
      return r ? [{ ...r }] : [];
    }
    if (/FROM reviews WHERE user_id = \? ORDER BY/.test(q)) {
      return state.reviews.filter(r => r.user_id === Number(params[0]))
        .sort((a, b) => b.created_at - a.created_at || b.id - a.id).map(r => ({ ...r }));
    }
    if (/FROM reviews WHERE course_id = \? AND course_type = \? ORDER BY/.test(q)) {
      return state.reviews.filter(r => r.course_id === Number(params[0]) && r.course_type === params[1])
        .sort((a, b) => b.created_at - a.created_at || b.id - a.id).map(r => ({ ...r }));
    }
    if (/FROM reviews WHERE id = \? LIMIT 1/.test(q)) {
      const r = state.reviews.find(x => x.id === Number(params[0]));
      return r ? [{ ...r }] : [];
    }
    if (/^INSERT INTO reviews /.test(q)) {
      const [user_id, course_id, course_type, booking_id, rating, comment] = params;
      const existing = state.reviews.find(r => r.user_id === Number(user_id) && r.course_id === Number(course_id) && r.course_type === course_type);
      if (existing) {
        Object.assign(existing, { booking_id: booking_id === null ? null : Number(booking_id), rating, comment, updated_at: now() });
        return { affectedRows: 2 };
      }
      const id = nextId('reviews');
      state.reviews.push({
        id, user_id: Number(user_id), course_id: Number(course_id), course_type,
        booking_id: booking_id === null ? null : Number(booking_id),
        rating, comment, created_at: now(), updated_at: now()
      });
      return { insertId: id, affectedRows: 1 };
    }

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

    // ── bookings & seats ──────────────────────────────────────────────────
    if (/\bbookings?\b|booking_extension_history|booking_reschedule_history|booking_attendance|booking_certificates|seats_available|booked_seats|course_venue_schedules s |course_location_dates d /.test(q)) {
      const handled = routeBookings(q, params);
      if (handled !== undefined) return handled;
    }

    // ── locations & scheduling ────────────────────────────────────────────
    if (/\blocations?\b|location_facilities|location_gallery|course_locations|course_location_dates|course_location_date_timings/.test(q)) {
      const handled = routeLocations(q, params);
      if (handled !== undefined) return handled;
    }

    // ── courses ───────────────────────────────────────────────────────────
    if (/\bcourses?\b|course_list_items|course_venues|course_venue_schedules|course_locations/.test(q)) {
      const handled = routeCourses(q, params);
      if (handled !== undefined) return handled;
    }

    if (/^DELETE FROM users WHERE id = \?/.test(q)) {
      const before = state.users.length;
      state.users = state.users.filter(u => u.id !== Number(params[0]));
      return { affectedRows: before - state.users.length };
    }
    if (/^DELETE FROM users WHERE id IN \(\?\)/.test(q)) {
      const ids = params[0].map(Number);
      const before = state.users.length;
      state.users = state.users.filter(u => !ids.includes(u.id));
      return { affectedRows: before - state.users.length };
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
    findCourse: (title) => state.courses.find(c => c.title === title),
    findLocation: (name) => state.locations.find(l => l.name === name),
    findBooking: (reference) => state.bookings.find(b => b.booking_reference === reference),
    findLicense: (title) => state.licenses.find(l => l.title === title),
    findJobListing: (title) => state.jobListings.find(j => j.title === title),
    findReview: (userId, courseId) => state.reviews.find(r => r.user_id === userId && r.course_id === courseId)
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
