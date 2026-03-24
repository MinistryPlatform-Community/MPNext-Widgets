/**
 * Types for embed widget authentication and configuration
 */

export interface WidgetClaims {
  sub: string;           // User GUID or "public" for anonymous
  wid: string;           // Widget ID (user-menu, add-to-calendar, etc.)
  mpAccessToken: string; // Ministry Platform OAuth token
  origin: string;        // Allowed embedding origin
  iat?: number;          // Issued at
  exp?: number;          // Expiry
  jti?: string;          // JWT ID for revocation
}

export interface SessionRequest {
  wid: string;
  /** MP OAuth access token from mpp-user-login widget; used to derive user GUID */
  mpUserToken?: string;
}

export interface SessionResponse {
  token: string;
  expiresIn: number;
}
