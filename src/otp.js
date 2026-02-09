/**
 * Extract OTP (numeric codes) from email content.
 * Looks for 4-8 digit codes commonly used as OTP/verification codes.
 */
function extractOTP(text) {
  if (!text) return null;

  // Clean HTML tags if present
  const clean = text.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ');

  // Patterns ordered by confidence (most specific first)
  const patterns = [
    // "mã xác minh/xác nhận là 123456" (Vietnamese)
    /m[aã]\s*(?:x[aá]c\s*(?:minh|nh[aậ]n|th[uự]c)|OTP)\s*(?:l[aà]|:)\s*(\d{4,8})/i,
    // "verification/confirmation code is 123456"
    /(?:verification|confirmation|security|login|sign.?in)\s*code\s*(?:is|:)\s*(\d{4,8})/i,
    // "your code is 123456"
    /your\s+(?:otp|code|pin)\s+(?:is|:)\s*(\d{4,8})/i,
    // "OTP: 123456" or "OTP is 123456"
    /\bOTP\s*[:\-\s]\s*(\d{4,8})\b/i,
    // "code: 123456"
    /\bcode\s*[:\-]\s*(\d{4,8})\b/i,
    // "mã: 123456" (Vietnamese)
    /\bm[aã]\s*[:\-]\s*(\d{4,8})\b/i,
    // Standalone bold/large numbers (often OTP in HTML emails)
    /(?:<b>|<strong>|<span[^>]*font-size[^>]*>)\s*(\d{4,8})\s*(?:<\/b>|<\/strong>|<\/span>)/i,
    // Generic: any 4-8 digit number that appears alone on a line or surrounded by spaces
    /(?:^|\s)(\d{4,8})(?:\s|$)/m,
  ];

  for (const pattern of patterns) {
    const match = clean.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }

  return null;
}

module.exports = { extractOTP };
