const DashboardService = require('../services/dashboardService');

const DashboardController = {
  // @desc    Admin dashboard: headline figures, charts and work queues
  // @route   GET /api/dashboard?startDate=&endDate=
  // @access  Private/Admin
  async getStats(req, res, next) {
    try {
      const range = { startDate: req.query.startDate, endDate: req.query.endDate };

      const [stats, performanceData, categoryData, recentActivity, bookings, lowSeats, pendingApprovals] = await Promise.all([
        DashboardService.headlineStats(range),
        DashboardService.performance(),
        DashboardService.categoryBreakdown(),
        DashboardService.recentActivity(),
        DashboardService.recentBookings(range),
        DashboardService.lowSeats(),
        DashboardService.pendingApprovals()
      ]);

      res.status(200).json({
        success: true,
        data: { stats, performanceData, categoryData, recentActivity, bookings, lowSeats, pendingApprovals }
      });
    } catch (error) {
      next(error);
    }
  },

  // @desc    Analytics page: customer, revenue and course performance
  // @route   GET /api/dashboard/analytics
  // @access  Private/Admin
  async getAnalytics(req, res, next) {
    try {
      const [customerData, revenueData, topCourses] = await Promise.all([
        DashboardService.customerTrend(),
        DashboardService.revenueTrend(),
        DashboardService.topCourses()
      ]);

      res.status(200).json({ success: true, data: { customerData, revenueData, topCourses } });
    } catch (error) {
      next(error);
    }
  }
};

module.exports = DashboardController;
