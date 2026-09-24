const express = require('express');
const JobController = require('../controllers/jobController');
const { protect, authorize, optionalProtect } = require('../middlewares/authMiddleware');
const { validate } = require('../middlewares/validateMiddleware');
const validators = require('../validators');

const router = express.Router();
const job = validators.job;
const adminOnly = [protect, authorize('admin')];

// Literal paths come before /:id so they are not read as an id
router.get('/my-applications', protect, JobController.getMyApplications);
router.get('/applications', ...adminOnly, validate(job.listApplications, 'query'), JobController.getApplications);
router.put('/applications/:id/status', ...adminOnly, validate(job.idParam, 'params'), validate(job.updateApplicationStatus), JobController.updateApplicationStatus);

// Public
router.get('/', optionalProtect, validate(job.listListings, 'query'), JobController.getListings);
router.get('/:id', optionalProtect, validate(job.idParam, 'params'), JobController.getListingById);
router.post('/apply/:id', optionalProtect, validate(job.idParam, 'params'), validate(job.apply), JobController.submitApplication);

// Admin
router.post('/', ...adminOnly, validate(job.createListing), JobController.createListing);
router.put('/:id', ...adminOnly, validate(job.idParam, 'params'), validate(job.updateListing), JobController.updateListing);
router.delete('/:id', ...adminOnly, validate(job.idParam, 'params'), JobController.deleteListing);

module.exports = router;
