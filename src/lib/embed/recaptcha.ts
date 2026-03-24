/**
 * Server-side reCAPTCHA v2 token verification
 */

interface RecaptchaVerifyResponse {
  success: boolean;
  challenge_ts?: string;
  hostname?: string;
  "error-codes"?: string[];
}

export async function verifyRecaptchaToken(
  token: string
): Promise<{ success: boolean }> {
  const secretKey = process.env.RECAPTCHA_SECRET_KEY;

  // Skip verification if secret key not configured (dev mode)
  if (!secretKey) {
    return { success: true };
  }

  try {
    const res = await fetch("https://www.google.com/recaptcha/api/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret: secretKey, response: token }),
    });

    if (!res.ok) {
      console.error("reCAPTCHA verify request failed:", res.status);
      return { success: false };
    }

    const data: RecaptchaVerifyResponse = await res.json();
    return { success: data.success };
  } catch (err) {
    console.error("reCAPTCHA verification error:", err);
    return { success: false };
  }
}
