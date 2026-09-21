const nodemailer = require('nodemailer');

const sendEmail = async (options) => {
    let transporter;

    // If real SMTP settings are provided in .env, use them.
    if (process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_EMAIL && process.env.SMTP_PASSWORD) {
        transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: process.env.SMTP_PORT,
            auth: {
                user: process.env.SMTP_EMAIL,
                pass: process.env.SMTP_PASSWORD
            }
        });
    } else {
        // Otherwise, use Ethereal Email for testing (fake SMTP service)
        const testAccount = await nodemailer.createTestAccount();
        transporter = nodemailer.createTransport({
            host: 'smtp.ethereal.email',
            port: 587,
            secure: false, // true for 465, false for other ports
            auth: {
                user: testAccount.user, // generated ethereal user
                pass: testAccount.pass  // generated ethereal password
            }
        });
        console.log('\n--- Using Ethereal Email (Test Account) ---');
    }

    const message = {
        from: `${process.env.FROM_NAME || 'Courses4Me'} <${process.env.FROM_EMAIL || 'noreply@courses4me.co.uk'}>`,
        to: options.email,
        subject: options.subject,
        text: options.message,
        html: options.html
    };

    const info = await transporter.sendMail(message);

    console.log('Message sent: %s', info.messageId);

    // If using Ethereal, log the preview URL so the user can click it
    if (!process.env.SMTP_HOST) {
        console.log('Preview URL: %s', nodemailer.getTestMessageUrl(info));
        console.log('-------------------------------------------\n');
    }
};

module.exports = sendEmail;
