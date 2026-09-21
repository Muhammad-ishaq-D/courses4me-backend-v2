const express = require('express');
const {
    createJobListing,
    getJobListings,
    getJobListingById,
    updateJobListing,
    deleteJobListing,
    submitJobApplication,
    getMyJobApplications,
    getJobApplications,
    updateApplicationStatus
} = require('../controllers/jobController');
const { protect, authorize, optionalProtect } = require('../middlewares/authMiddleware');

const router = express.Router();

// 1. Literal / Specific GET routes first
router.get('/my-applications', protect, getMyJobApplications);
router.get('/applications', protect, authorize('admin'), getJobApplications);

// 2. Specific PUT routes first
router.put('/applications/:id/status', protect, authorize('admin'), updateApplicationStatus);

// 3. Public GET routes
router.get('/', optionalProtect, getJobListings);
router.get('/:id', optionalProtect, getJobListingById);
router.post('/apply/:id', optionalProtect, submitJobApplication); // Public application submission with optional auth

// 4. Protected Admin routes for Jobs
router.post('/', protect, authorize('admin'), createJobListing);
router.put('/:id', protect, authorize('admin'), updateJobListing);
router.delete('/:id', protect, authorize('admin'), deleteJobListing);

module.exports = router;
