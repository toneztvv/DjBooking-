#!/usr/bin/env node
/*
 * Generates a printable QR code PNG pointing at the site homepage.
 * Usage: node scripts/generate-qr.js [output-path] [size]
 */
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const { getQrTargetUrl } = require('../src/qr');

async function main() {
  const outputPath = process.argv[2] || path.join(__dirname, '..', 'djxpress-qr.png');
  const size = Number(process.argv[3]) || 1200;
  const url = getQrTargetUrl();

  await QRCode.toFile(outputPath, url, {
    type: 'png',
    width: size,
    margin: 2,
    color: { dark: '#0b0b12', light: '#ffffff' },
  });

  console.log(`QR code for ${url}`);
  console.log(`Saved to ${path.resolve(outputPath)}`);
}

main().catch((err) => {
  console.error('Failed to generate QR code:', err);
  process.exitCode = 1;
});
