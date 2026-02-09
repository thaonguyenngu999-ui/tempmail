/**
 * Extract OTP (numeric codes 4-8 digits) from email content.
 */
export function extractOTP(text) {
  if (!text) return null;

  const clean = text.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ');

  const patterns = [
    // "mã xác minh/xác nhận là 123456" (Vietnamese)
    /m[aã]\s*(?:x[aá]c\s*(?:minh|nh[aậ]n|th[uự]c)|OTP)\s*(?:l[aà]|:)\s*(\d{4,8})/i,
    // "verification/confirmation code is 123456"
    /(?:verification|confirmation|security|login|sign.?in)\s*code\s*(?:is|:)\s*(\d{4,8})/i,
    // "your otp/code/pin/otp code is 123456"
    /your\s+(?:otp\s+)?(?:code|pin|otp)\s+(?:is|:)\s*(\d{4,8})/i,
    // "OTP: 123456" or "OTP is 123456" or "OTP code is 123456"
    /\bOTP[\s:.\-]*(?:code[\s:.\-]*)?(?:is[\s:.\-]*)?\s*(\d{4,8})/i,
    // "code: 123456" or "code is 123456" or "code is: 123456"
    /\bcode\s*(?:is\s*)?[:\-]\s*(\d{4,8})/i,
    // "mã: 123456" (Vietnamese)
    /\bm[aã]\s*[:\-]\s*(\d{4,8})/i,
    // Bold/large numbers in HTML (often OTP)
    /(?:<b>|<strong>|<span[^>]*font-size[^>]*>)\s*(\d{4,8})\s*(?:<\/b>|<\/strong>|<\/span>)/i,
    // Any 4-8 digit number surrounded by non-digit chars
    /(?:^|[^\d])(\d{4,8})(?:[^\d]|$)/m,
  ];

  for (const pattern of patterns) {
    const match = clean.match(pattern);
    if (match && match[1]) return match[1];
  }

  return null;
}
