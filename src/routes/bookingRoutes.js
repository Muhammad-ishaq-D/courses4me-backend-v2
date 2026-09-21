const express = require('express');
console.log('--- LOADING BOOKING ROUTES ---');
const router = express.Router();
const {
    createBooking,
    getBookingByReference,
    getBookings,
    getCustomers,
    getBookingById,
    updateUser,
    deleteUser,
    deleteUsers,
    getUserById,
    updateBooking,
    deleteBooking,
    updateLifecycle,
    getMyBookingStatus,
    requestRefund,
    processRefund
} = require('../controllers/bookingController');
const { protect, authorize } = require('../middlewares/authMiddleware');
const { validateBooking } = require('../middlewares/validators');
const uploadProof = require('../middlewares/uploadProofMiddleware');

router.post('/', validateBooking, createBooking);
router.get('/reference/:ref', getBookingByReference);
router.get('/my-status/:courseId', protect, getMyBookingStatus);
router.get('/', protect, authorize('admin'), getBookings);
router.get('/users', protect, authorize('admin'), getCustomers);
router.post('/users/bulk-delete', protect, authorize('admin'), deleteUsers);
router.get('/users/:id', protect, authorize('admin'), getUserById);
router.put('/users/:id', protect, authorize('admin'), updateUser);
router.delete('/users/:id', protect, authorize('admin'), deleteUser);

router.post('/:id/refund/request', protect, uploadProof.single('proof'), requestRefund);
router.post('/:id/refund/process', protect, authorize('admin', 'editor'), processRefund);

router.get('/:id', protect, authorize('admin'), getBookingById);
router.put('/:id', protect, authorize('admin'), updateBooking);
router.put('/:id/lifecycle', protect, authorize('admin'), updateLifecycle);
router.delete('/:id', protect, authorize('admin'), deleteBooking);

module.exports = router;
