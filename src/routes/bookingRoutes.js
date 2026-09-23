const express = require('express');
const BookingController = require('../controllers/bookingController');
const { protect, authorize } = require('../middlewares/authMiddleware');
const { validate } = require('../middlewares/validateMiddleware');
const uploadProof = require('../middlewares/uploadProofMiddleware');
const validators = require('../validators');

const router = express.Router();
const booking = validators.booking;
const adminOnly = [protect, authorize('admin')];

// Public — the checkout posts here, and a reference can be looked up
router.post('/', validate(booking.create), BookingController.create);
router.get('/reference/:ref', validate(booking.referenceParam, 'params'), BookingController.getByReference);

// Student
router.get('/my-status/:courseId', protect, validate(booking.courseIdParam, 'params'), BookingController.getMyBookingStatus);

// Customers (the admin users table lives under this router)
router.get('/', ...adminOnly, validate(booking.list, 'query'), BookingController.getAll);
router.get('/users', ...adminOnly, validate(booking.listCustomers, 'query'), BookingController.getCustomers);
router.post('/users/bulk-delete', ...adminOnly, validate(booking.bulkDelete), BookingController.deleteUsers);
router.get('/users/:id', ...adminOnly, validate(booking.idParam, 'params'), BookingController.getUserById);
router.put('/users/:id', ...adminOnly, validate(booking.idParam, 'params'), validate(booking.updateCustomer), BookingController.updateUser);
router.delete('/users/:id', ...adminOnly, validate(booking.idParam, 'params'), BookingController.deleteUser);

// Refunds
router.post('/:id/refund/request', protect, validate(booking.idParam, 'params'), uploadProof.single('proof'), validate(booking.refundRequest), BookingController.requestRefund);
router.post('/:id/refund/process', protect, authorize('admin', 'editor'), validate(booking.idParam, 'params'), validate(booking.refundProcess), BookingController.processRefund);

// One booking
router.get('/:id', ...adminOnly, validate(booking.idParam, 'params'), BookingController.getById);
router.put('/:id', ...adminOnly, validate(booking.idParam, 'params'), validate(booking.update), BookingController.update);
router.put('/:id/lifecycle', ...adminOnly, validate(booking.idParam, 'params'), validate(booking.lifecycle), BookingController.updateLifecycle);
router.delete('/:id', ...adminOnly, validate(booking.idParam, 'params'), BookingController.delete);

module.exports = router;
