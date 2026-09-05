const nodemailer = require('nodemailer');

function getTransporter() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return null;

  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  });
}

async function sendInquiryNotification(inquiry) {
  const transporter = getTransporter();
  if (!transporter) {
    console.warn(
      'Email notifications not configured (missing GMAIL_USER / GMAIL_APP_PASSWORD) — skipping.'
    );
    return;
  }

  const lines = [
    `Name: ${inquiry.name}`,
    `Email: ${inquiry.email}`,
    inquiry.phone && `Phone: ${inquiry.phone}`,
    inquiry.eventDate && `Event date: ${inquiry.eventDate}`,
    inquiry.eventType && `Event type: ${inquiry.eventType}`,
    inquiry.location && `Venue / location: ${inquiry.location}`,
    inquiry.guestCount && `Estimated guests: ${inquiry.guestCount}`,
    inquiry.message && `\nMessage:\n${inquiry.message}`,
  ].filter(Boolean);

  await transporter.sendMail({
    from: `"DJXpress Website" <${process.env.GMAIL_USER}>`,
    to: process.env.GMAIL_USER,
    replyTo: inquiry.email,
    subject: `New booking inquiry from ${inquiry.name}`,
    text: lines.join('\n'),
  });
}

module.exports = { sendInquiryNotification };
