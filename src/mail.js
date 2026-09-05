// Uses Resend's HTTP API rather than raw SMTP: many hosts (Render included)
// block or time out outbound SMTP connections, but a plain HTTPS request
// like this always goes through.

async function sendInquiryNotification(inquiry) {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.GMAIL_USER;

  if (!apiKey || !to) {
    console.warn(
      'Email notifications not configured (missing RESEND_API_KEY / GMAIL_USER) — skipping.'
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

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'DJXpress Website <onboarding@resend.dev>',
      to: [to],
      reply_to: inquiry.email,
      subject: `New booking inquiry from ${inquiry.name}`,
      text: lines.join('\n'),
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend API error ${res.status}: ${body}`);
  }
}

module.exports = { sendInquiryNotification };
