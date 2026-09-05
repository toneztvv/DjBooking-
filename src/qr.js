const QRCode = require('qrcode');

function getSiteUrl() {
  return (process.env.SITE_URL || 'http://localhost:3000').replace(/\/+$/, '');
}

function getLiveUrl() {
  return `${getSiteUrl()}/live`;
}

async function liveQrBuffer(size = 512) {
  return QRCode.toBuffer(getLiveUrl(), {
    type: 'png',
    width: size,
    margin: 2,
    color: {
      dark: '#0b0b12',
      light: '#ffffff',
    },
  });
}

module.exports = { getSiteUrl, getLiveUrl, liveQrBuffer };
