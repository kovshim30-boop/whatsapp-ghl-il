import QRCode from 'qrcode';

export async function generateQRDataURL(qrText) {
  try {
    const qrDataURL = await QRCode.toDataURL(qrText, {
      width: 400,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    });
    return qrDataURL;
  } catch (err) {
    throw new Error(`Failed to generate QR code: ${err.message}`);
  }
}
