/**
 * Extract OTP (numeric codes 4-8 digits) from email content.
 */
export function extractOTP(text) {
  if (!text) return null;

  const clean = text.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ');

  const patterns = [
    /m[aã]\s*(?:x[aá]c\s*(?:minh|nh[aậ]n|th[uự]c)|OTP)\s*(?:l[aà]|:)\s*(\d{4,8})/i,
    /(?:verification|confirmation|security|login|sign.?in)\s*code\s*(?:is|:)\s*(\d{4,8})/i,
    /your\s+(?:otp|code|pin)\s+(?:is|:)\s*(\d{4,8})/i,
    /\bOTP\s*[:\-\s]\s*(\d{4,8})\b/i,
    /\bcode\s*[:\-]\s*(\d{4,8})\b/i,
    /\bm[aã]\s*[:\-]\s*(\d{4,8})\b/i,
    /(?:<b>|<strong>|<span[^>]*font-size[^>]*>)\s*(\d{4,8})\s*(?:<\/b>|<\/strong>|<\/span>)/i,
    /(?:^|\s)(\d{4,8})(?:\s|$)/m,
  ];

  for (const pattern of patterns) {
    const match = clean.match(pattern);
    if (match && match[1]) return match[1];
  }

  return null;
}
