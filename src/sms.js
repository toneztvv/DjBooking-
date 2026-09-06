// Sends a text via Twilio's REST API (https://www.twilio.com) — plain
// fetch + Basic Auth, no SDK needed.

async function sendSms(message) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;
  const toNumber = process.env.NOTIFY_PHONE_NUMBER;

  if (!accountSid || !authToken || !fromNumber || !toNumber) {
    console.warn(
      'SMS notifications not configured (missing TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER / NOTIFY_PHONE_NUMBER) — skipping.'
    );
    return;
  }

  const params = new URLSearchParams();
  params.append('To', toNumber);
  params.append('From', fromNumber);
  params.append('Body', message);

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Twilio API error ${res.status}: ${text}`);
  }
}

module.exports = { sendSms };
