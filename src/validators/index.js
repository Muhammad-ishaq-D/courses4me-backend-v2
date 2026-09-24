// One entry per module.
module.exports = {
  auth: require('./authValidator'),
  course: require('./courseValidator'),
  location: require('./locationValidator'),
  courseLocation: require('./courseLocationValidator'),
  booking: require('./bookingValidator'),
  settings: require('./settingsValidator'),
  dashboard: require('./dashboardValidator')
};
