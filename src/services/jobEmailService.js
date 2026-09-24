const sendEmail = require('../utils/sendEmail');
const logger = require('../utils/logger');

/**
 * The two emails the jobs board sends a candidate. Both resolve even when
 * delivery fails — an application must never be lost because of the mail
 * server.
 */
const BRAND = '#F8510C';
const SITE = () => process.env.FRONTEND_URL || 'https://courses4me.co.uk';

const frame = (inner) => `
  <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 12px; background-color: #ffffff;">
    ${inner}
    <div style="text-align: center; margin-top: 30px; border-top: 1px solid #eee; padding-top: 20px;">
      <p style="color: #888; font-size: 14px;">If you have any questions, please contact our support team.</p>
      <p style="color: #888; font-size: 14px;">&copy; ${new Date().getFullYear()} Courses4Me. All rights reserved.</p>
    </div>
  </div>`;

const row = (label, value, highlight = false) => `
  <tr>
    <td style="padding: 8px 0; color: #666; font-weight: bold;">${label}:</td>
    <td style="padding: 8px 0; color: ${highlight ? BRAND : '#333'}; text-align: right; ${highlight ? 'font-weight: bold;' : ''}">${value}</td>
  </tr>`;

/** What the candidate is told for each decision. */
const STATUS_COPY = {
  Pending: { heading: 'Application Received', body: 'Your application is with our recruitment team.' },
  Shortlisted: { heading: 'You have been shortlisted!', body: 'Your application stood out and has been shortlisted. We will be in touch with the next steps shortly.' },
  Interview: { heading: 'Interview invitation', body: 'We would like to invite you to an interview. Our team will contact you to arrange a time.' },
  Accepted: { heading: 'Congratulations — offer made!', body: 'We are delighted to offer you the role. Our team will be in touch with the paperwork.' },
  Rejected: { heading: 'Application update', body: 'After careful consideration we will not be taking your application further on this occasion. We wish you the very best, and you are welcome to apply for future vacancies.' }
};

async function deliver(label, options) {
  try {
    await sendEmail(options);
    logger.debug(`[jobEmail] sent ${label} to ${options.email}`);
  } catch (err) {
    logger.error(`[jobEmail] ${label} failed for ${options.email}: ${err.message}`);
  }
}

const JobEmailService = {
  STATUS_COPY,

  /** Confirms the application and gives the candidate their reference. */
  async applicationReceived({ application, job }) {
    await deliver('application confirmation', {
      email: application.email,
      subject: `Application Submitted Successfully - Reference: ${application.applicationReference}`,
      message: `Thank you for applying for the ${job.title} role! Reference: ${application.applicationReference}.`,
      html: frame(`
        <div style="text-align: center; margin-bottom: 20px;">
          <h1 style="color: ${BRAND}; margin: 0;">Application Received!</h1>
          <p style="color: #666; font-size: 16px;">Thank you for your interest in joining Courses4Me</p>
        </div>
        <div style="background-color: #f9f9f9; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
          <h3 style="margin-top: 0; color: #333; border-bottom: 2px solid ${BRAND}; padding-bottom: 8px;">Application Details</h3>
          <table style="width: 100%; border-collapse: collapse;">
            ${row('Reference Code', application.applicationReference, true)}
            ${row('Position', job.title)}
            ${row('Company', job.company || 'Courses4Me')}
            ${row('Applicant Name', `${application.firstName} ${application.lastName}`)}
            ${row('SIA License Status', application.license)}
            ${row('Experience Level', application.experience)}
          </table>
        </div>
        <div style="background-color: #FFF7F3; border-left: 4px solid ${BRAND}; padding: 15px; border-radius: 6px;">
          <h4 style="margin: 0 0 5px 0; color: ${BRAND};">What happens next?</h4>
          <p style="margin: 0; color: #555; font-size: 13.5px; line-height: 1.5;">Our recruitment team will review your details and CV. If your qualifications match our active requirements, we will contact you directly to schedule an interview. You can track your real-time application status anytime inside your Student Dashboard.</p>
        </div>`)
    });
  },

  /** Tells the candidate their application moved to a new stage. */
  async statusChanged({ application, status, reason }) {
    const copy = STATUS_COPY[status] || STATUS_COPY.Pending;
    const note = reason
      ? `<div style="background-color: #f5f5f5; padding: 15px; border-radius: 8px; margin: 20px 0;"><h4 style="margin-top: 0;">Note from the team:</h4><p style="margin-bottom: 0; color: #555;">${reason}</p></div>`
      : '';

    await deliver('application status update', {
      email: application.email,
      subject: `Application Update: ${application.jobTitle} (${status})`,
      message: `Your application ${application.applicationReference} for ${application.jobTitle} is now: ${status}. ${copy.body}`,
      html: frame(`
        <div style="text-align: center; margin-bottom: 20px;">
          <h1 style="color: ${BRAND}; margin: 0;">${copy.heading}</h1>
        </div>
        <p style="color: #333;">Hello ${application.firstName},</p>
        <p style="color: #555; line-height: 1.6;">${copy.body}</p>
        <div style="background-color: #f9f9f9; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <table style="width: 100%; border-collapse: collapse;">
            ${row('Reference Code', application.applicationReference, true)}
            ${row('Position', application.jobTitle)}
            ${row('Status', status)}
          </table>
        </div>
        ${note}
        <div style="text-align: center; margin-top: 20px;">
          <a href="${SITE()}/dashboard" style="display: inline-block; background-color: ${BRAND}; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: 600;">View Your Applications</a>
        </div>`)
    });
  }
};

module.exports = JobEmailService;
