const JobModel = require('../models/jobModel');
const UserModel = require('../models/userModel');
const notifyAdmins = require('../utils/notifyAdmins');
const logger = require('../utils/logger');
const emails = require('../services/jobEmailService');

/** A vacancy with its requirements attached. */
async function loadListing(row) {
  const requirements = await JobModel.requirementsFor([row.id]);
  return JobModel.listingToPublic(row, { requirements: requirements[row.id] || [] });
}

const JobController = {
  // ── job listings ─────────────────────────────────────────────────────────

  // @desc    Create a vacancy
  // @route   POST /api/jobs
  // @access  Private/Admin
  async createListing(req, res, next) {
    try {
      const id = await JobModel.createListing(req.body);
      const listing = await loadListing(await JobModel.findListingById(id));
      res.status(201).json({ success: true, data: listing, listing });
    } catch (error) {
      next(error);
    }
  },

  // @desc    List vacancies
  // @route   GET /api/jobs?category=&type=&status=&search=
  // @access  Public
  async getListings(req, res, next) {
    try {
      // Paused and closed vacancies stay visible so the board can badge them.
      const rows = await JobModel.findListings(req.query);
      const requirements = await JobModel.requirementsFor(rows.map(r => r.id));

      const listings = rows.map(row => JobModel.listingToPublic(row, { requirements: requirements[row.id] || [] }));

      res.status(200).json({
        success: true,
        listings,
        // the same list under the key the other service reads
        data: { listings },
        count: listings.length
      });
    } catch (error) {
      next(error);
    }
  },

  // @desc    Get one vacancy
  // @route   GET /api/jobs/:id
  // @access  Public
  async getListingById(req, res, next) {
    try {
      const row = await JobModel.findListingById(req.params.id);
      if (!row) return res.status(404).json({ success: false, message: 'Job listing not found' });

      const listing = await loadListing(row);
      res.status(200).json({ success: true, data: listing, listing });
    } catch (error) {
      next(error);
    }
  },

  // @desc    Update a vacancy
  // @route   PUT /api/jobs/:id
  // @access  Private/Admin
  async updateListing(req, res, next) {
    try {
      const existing = await JobModel.findListingById(req.params.id);
      if (!existing) return res.status(404).json({ success: false, message: 'Job listing not found' });

      await JobModel.updateListing(existing.id, req.body);
      const listing = await loadListing(await JobModel.findListingById(existing.id));
      res.status(200).json({ success: true, data: listing, listing });
    } catch (error) {
      next(error);
    }
  },

  // @desc    Delete a vacancy
  // @route   DELETE /api/jobs/:id
  // @access  Private/Admin
  async deleteListing(req, res, next) {
    try {
      const deleted = await JobModel.deleteListing(req.params.id);
      if (!deleted) return res.status(404).json({ success: false, message: 'Job listing not found' });
      res.status(200).json({ success: true, message: 'Job listing deleted successfully', data: {} });
    } catch (error) {
      next(error);
    }
  },

  // ── applications ─────────────────────────────────────────────────────────

  // @desc    Apply for a vacancy
  // @route   POST /api/jobs/apply/:id
  // @access  Public (an account is used when the caller is signed in)
  async submitApplication(req, res, next) {
    try {
      const job = await JobModel.findListingById(req.params.id);
      if (!job) return res.status(404).json({ success: false, message: 'Job listing not found' });

      const cleanEmail = String(req.body.email || '').trim().toLowerCase();

      // One application per candidate per vacancy, matched by account or email.
      const existing = await JobModel.findExistingApplication(job.id, {
        userId: req.user?.id,
        email: req.user ? null : cleanEmail
      });
      if (existing) {
        return res.status(400).json({ success: false, message: 'You have already applied for this job listing.' });
      }

      let user = req.user ? await UserModel.findById(req.user.id) : await UserModel.findByEmail(cleanEmail);

      // A candidate who supplies a password gets an account with the application.
      if (!user && req.body.password && cleanEmail) {
        const id = await UserModel.create({
          name: `${req.body.firstName} ${req.body.lastName}`,
          email: cleanEmail,
          phone: req.body.phone,
          role: 'customer',
          passwordHash: await UserModel.hashPassword(req.body.password)
        });
        user = await UserModel.findById(id);
        await UserModel.addActivity(id, {
          action: 'Registration',
          details: 'Account automatically created during first job application'
        });
      }

      const applicationId = await JobModel.createApplication({
        ...req.body,
        email: cleanEmail,
        jobListingId: job.id,
        jobTitle: job.title,
        userId: user ? user.id : null
      });
      const application = JobModel.applicationToPublic(await JobModel.findApplicationById(applicationId));

      if (user) {
        await UserModel.addActivity(user.id, {
          action: 'Job Application',
          details: `Applied for: ${job.title} at ${job.company || 'Courses4Me'}`
        }).catch(err => logger.error('Activity log error:', err.message));
      }

      await notifyAdmins({
        title: 'New Job Application',
        message: `New application for ${job.title} by ${req.body.firstName} ${req.body.lastName}`,
        type: 'user'
      });
      await emails.applicationReceived({ application, job });

      res.status(201).json({
        success: true,
        data: application,
        refNumber: application.applicationReference,
        message: 'Application submitted successfully',
        user: user ? { _id: String(user.id), name: user.name, email: user.email, role: user.role } : null
      });
    } catch (error) {
      next(error);
    }
  },

  // @desc    The signed-in candidate's applications
  // @route   GET /api/jobs/my-applications
  // @access  Private
  async getMyApplications(req, res, next) {
    try {
      const rows = await JobModel.findApplicationsForUser(req.user.id, req.user.email);
      const listings = await JobModel.listingsByIds([...new Set(rows.map(r => r.job_listing_id).filter(Boolean))]);

      const applications = rows.map(row => JobModel.applicationToPublic(row, {
        listing: JobModel.listingSummary(listings[row.job_listing_id])
      }));

      res.status(200).json({ success: true, applications, count: applications.length });
    } catch (error) {
      next(error);
    }
  },

  // @desc    Every application
  // @route   GET /api/jobs/applications?status=&search=
  // @access  Private/Admin
  async getApplications(req, res, next) {
    try {
      const rows = await JobModel.findApplications(req.query);
      const applications = rows.map(row => JobModel.applicationToPublic(row));

      res.status(200).json({
        success: true,
        applications,
        data: { applications },
        count: applications.length
      });
    } catch (error) {
      next(error);
    }
  },

  // @desc    Move an application to a new stage
  // @route   PUT /api/jobs/applications/:id/status
  // @access  Private/Admin
  async updateApplicationStatus(req, res, next) {
    try {
      const { status, reason } = req.body;
      const existing = await JobModel.findApplicationById(req.params.id);
      if (!existing) return res.status(404).json({ success: false, message: 'Job application not found' });

      await JobModel.updateApplicationStatus(existing.id, status);
      const application = JobModel.applicationToPublic(await JobModel.findApplicationById(existing.id));

      await emails.statusChanged({ application, status, reason });

      res.status(200).json({ success: true, data: application });
    } catch (error) {
      next(error);
    }
  }
};

module.exports = JobController;
