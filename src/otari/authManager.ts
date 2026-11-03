/**
 * WildGuard - Ingress Authentication & Session Manager
 * Protects live inference endpoints with owner-controlled access token.
 * Features timing-safe comparison, brute-force mitigation, and HMAC-signed session cookies.
 */

import * as crypto from 'node:crypto';
import type { IncomingMessage } from 'node:http';

export interface AuthConfig {
  accessToken?: string;
  sessionSecret?: string;
  sessionTtlMs?: number;
  maxFailedAttempts?: number;
  lockoutMs?: number;
}

export interface SessionVerificationResult {
  valid: boolean;
  reason?: string;
}

interface FailedAttemptRecord {
  count: number;
  lockedUntil?: number;
  firstAttemptAt: number;
}

export class AuthManager {
  private readonly accessToken?: string;
  private readonly sessionSecret: string;
  private readonly sessionTtlMs: number;
  private readonly maxFailedAttempts: number;
  private readonly lockoutMs: number;
  private readonly failedAttempts = new Map<string, FailedAttemptRecord>();
  private readonly revokedSessions = new Set<string>();

  constructor(config: AuthConfig = {}) {
    this.accessToken = config.accessToken?.trim() || undefined;
    // Derive a session HMAC secret from access token or random bytes
    this.sessionSecret = config.sessionSecret || (this.accessToken
      ? crypto.createHmac('sha256', this.accessToken).update('wildguard_session_salt').digest('hex')
      : crypto.randomBytes(32).toString('hex'));
    this.sessionTtlMs = config.sessionTtlMs || 2 * 60 * 60 * 1000; // 2 hours
    this.maxFailedAttempts = config.maxFailedAttempts || 5;
    this.lockoutMs = config.lockoutMs || 15 * 60 * 1000; // 15 minutes lockout
  }

  public hasAccessToken(): boolean {
    return Boolean(this.accessToken && this.accessToken.length > 0);
  }

  /**
   * Timing-safe verification of the master access token
   */
  public verifyAccessToken(provided: unknown): boolean {
    if (!this.hasAccessToken() || typeof provided !== 'string') {
      return false;
    }
    const cleanProvided = provided.trim();
    if (cleanProvided.length === 0) return false;

    // Use SHA-256 hash digests to ensure fixed-length buffers for timingSafeEqual
    const hashProvided = crypto.createHash('sha256').update(cleanProvided).digest();
    const hashActual = crypto.createHash('sha256').update(this.accessToken!).digest();
    return crypto.timingSafeEqual(hashProvided, hashActual);
  }

  /**
   * Brute force check for client IP
   */
  public checkBruteForce(clientIp: string): { allowed: boolean; retryAfterSeconds?: number } {
    const record = this.failedAttempts.get(clientIp);
    if (!record) return { allowed: true };

    const now = Date.now();
    if (record.lockedUntil && record.lockedUntil > now) {
      const remainingSeconds = Math.ceil((record.lockedUntil - now) / 1000);
      return { allowed: false, retryAfterSeconds: remainingSeconds };
    }

    // Reset if window has passed
    if (now - record.firstAttemptAt > this.lockoutMs) {
      this.failedAttempts.delete(clientIp);
      return { allowed: true };
    }

    return { allowed: true };
  }

  /**
   * Record a failed login attempt
   */
  public recordFailedAttempt(clientIp: string): void {
    const now = Date.now();
    const record = this.failedAttempts.get(clientIp) || { count: 0, firstAttemptAt: now };
    record.count += 1;

    if (record.count >= this.maxFailedAttempts) {
      record.lockedUntil = now + this.lockoutMs;
    }
    this.failedAttempts.set(clientIp, record);
  }

  /**
   * Clear failed attempts on successful login
   */
  public recordSuccessfulLogin(clientIp: string): void {
    this.failedAttempts.delete(clientIp);
  }

  /**
   * Create an HMAC-signed session token
   */
  public createSession(): { sessionToken: string; expiresAt: number; cookieHeader: string } {
    const id = crypto.randomBytes(16).toString('hex');
    const timestamp = Date.now();
    const expiresAt = timestamp + this.sessionTtlMs;
    const payload = `v1:${id}:${timestamp}:${expiresAt}`;
    const signature = crypto.createHmac('sha256', this.sessionSecret).update(payload).digest('base64url');
    const sessionToken = `${payload}:${signature}`;

    const isSecure = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
    const cookieHeader = `wildguard_session=${sessionToken}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(this.sessionTtlMs / 1000)}${isSecure ? '; Secure' : ''}`;

    return {
      sessionToken,
      expiresAt,
      cookieHeader,
    };
  }

  /**
   * Validate an HMAC-signed session token
   */
  public verifySession(sessionToken: unknown): SessionVerificationResult {
    if (typeof sessionToken !== 'string' || !sessionToken.trim()) {
      return { valid: false, reason: 'Missing session token' };
    }

    const parts = sessionToken.trim().split(':');
    if (parts.length !== 5) {
      return { valid: false, reason: 'Malformed session token' };
    }

    const [version, id, timestampStr, expiresAtStr, signature] = parts;
    if (version !== 'v1') {
      return { valid: false, reason: 'Unsupported session token version' };
    }

    const expiresAt = parseInt(expiresAtStr, 10);
    if (isNaN(expiresAt) || Date.now() > expiresAt) {
      return { valid: false, reason: 'Session token expired' };
    }

    const payload = `${version}:${id}:${timestampStr}:${expiresAtStr}`;
    const expectedSignature = crypto.createHmac('sha256', this.sessionSecret).update(payload).digest('base64url');

    try {
      const bufA = Buffer.from(signature, 'utf8');
      const bufB = Buffer.from(expectedSignature, 'utf8');
      if (bufA.length !== bufB.length || !crypto.timingSafeEqual(bufA, bufB)) {
        return { valid: false, reason: 'Invalid session signature' };
      }
    } catch {
      return { valid: false, reason: 'Session verification failure' };
    }

    if (this.revokedSessions.has(id)) {
      return { valid: false, reason: 'Session has been revoked' };
    }

    return { valid: true };
  }

  /**
   * Asynchronously validates session token, checking persistent Redis revocation store
   */
  public async verifySessionAsync(sessionToken: unknown, budgetManager?: any): Promise<SessionVerificationResult> {
    const basic = this.verifySession(sessionToken);
    if (!basic.valid) return basic;

    const parts = (sessionToken as string).trim().split(':');
    const id = parts[1];
    if (this.revokedSessions.has(id)) {
      return { valid: false, reason: 'Session has been revoked' };
    }

    if (budgetManager && typeof budgetManager.get === 'function') {
      try {
        const isRevoked = await budgetManager.get(`wildguard:session:revoked:${id}`);
        if (isRevoked) {
          this.revokedSessions.add(id);
          return { valid: false, reason: 'Session has been revoked' };
        }
      } catch {
        // Fallback safely to in-memory check
      }
    }

    return { valid: true };
  }

  /**
   * Revoke session on logout (HIGH-4)
   */
  public async revokeSession(sessionToken: unknown, budgetManager?: any): Promise<boolean> {
    if (typeof sessionToken !== 'string' || !sessionToken.trim()) return false;
    const parts = sessionToken.trim().split(':');
    if (parts.length !== 5) return false;
    const id = parts[1];
    this.revokedSessions.add(id);

    if (budgetManager && typeof budgetManager.set === 'function') {
      try {
        await budgetManager.set(`wildguard:session:revoked:${id}`, '1', Math.floor(this.sessionTtlMs / 1000));
      } catch {
        // Local revocation retained
      }
    }
    return true;
  }

  /**
   * Distributed Brute-force check backed by Redis (HIGH-1)
   */
  public async checkBruteForceAsync(clientIp: string, budgetManager?: any): Promise<{ allowed: boolean; retryAfterSeconds?: number }> {
    if (budgetManager && typeof budgetManager.get === 'function' && budgetManager.isConfigured?.()) {
      try {
        const raw = await budgetManager.get(`wildguard:auth:failed:${clientIp}`);
        if (raw) {
          const count = parseInt(raw, 10);
          if (count >= this.maxFailedAttempts) {
            return { allowed: false, retryAfterSeconds: Math.ceil(this.lockoutMs / 1000) };
          }
        }
      } catch {
        // Fallback to in-memory
      }
    }
    return this.checkBruteForce(clientIp);
  }

  public async recordFailedAttemptAsync(clientIp: string, budgetManager?: any): Promise<void> {
    this.recordFailedAttempt(clientIp);
    if (budgetManager && typeof budgetManager.incrWithExpiry === 'function' && budgetManager.isConfigured?.()) {
      try {
        await budgetManager.incrWithExpiry(`wildguard:auth:failed:${clientIp}`, Math.ceil(this.lockoutMs / 1000));
      } catch {
        // Local record retained
      }
    }
  }

  public async recordSuccessfulLoginAsync(clientIp: string, budgetManager?: any): Promise<void> {
    this.recordSuccessfulLogin(clientIp);
    if (budgetManager && typeof budgetManager.del === 'function' && budgetManager.isConfigured?.()) {
      try {
        await budgetManager.del(`wildguard:auth:failed:${clientIp}`);
      } catch {
        // Local record cleared
      }
    }
  }

  /**
   * Extract credentials from IncomingMessage (Cookie, Authorization Bearer, or X-WildGuard-Access-Token)
   */
  public extractCredentials(req: IncomingMessage): {
    sessionToken?: string;
    bearerToken?: string;
    directToken?: string;
    publicSessionId?: string;
  } {
    let sessionToken: string | undefined;
    let bearerToken: string | undefined;
    let directToken: string | undefined;
    let publicSessionId: string | undefined;

    // 1. Check cookies
    const cookieHeader = req.headers.cookie;
    if (cookieHeader) {
      const match = cookieHeader.match(/(?:^|;\s*)wildguard_session=([^;]+)/);
      if (match) {
        sessionToken = decodeURIComponent(match[1]);
      }
      const pubMatch = cookieHeader.match(/(?:^|;\s*)wildguard_public_session=([^;]+)/);
      if (pubMatch) {
        publicSessionId = decodeURIComponent(pubMatch[1]).replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 48);
      }
    }

    // 2. Check headers for public session fallback
    const headerPub = req.headers['x-wildguard-session-id'];
    if (!publicSessionId && typeof headerPub === 'string' && headerPub.trim()) {
      publicSessionId = headerPub.trim().replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 48);
    }

    // 3. Check Authorization header
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7).trim();
      // Could be session token or direct access token
      if (token.startsWith('v1:')) {
        sessionToken = token;
      } else {
        bearerToken = token;
      }
    }

    // 3. Check custom header
    const customHeader = req.headers['x-wildguard-access-token'];
    if (typeof customHeader === 'string' && customHeader.trim()) {
      directToken = customHeader.trim();
    }

    return { sessionToken, bearerToken, directToken, publicSessionId };
  }

  /**
   * Checks whether the request is authenticated with master owner credentials
   */
  public isOwner(req: IncomingMessage): boolean {
    if (!this.hasAccessToken()) return false;
    const creds = this.extractCredentials(req);
    if (creds.sessionToken) {
      const res = this.verifySession(creds.sessionToken);
      if (res.valid) return true;
    }
    const candidate = creds.bearerToken || creds.directToken;
    if (candidate && this.verifyAccessToken(candidate)) {
      return true;
    }
    return false;
  }

  /**
   * Resolves or generates a public session identifier and cookie
   */
  public resolvePublicSession(req: IncomingMessage): { sessionId: string; setCookieHeader?: string } {
    const creds = this.extractCredentials(req);
    if (creds.publicSessionId && creds.publicSessionId.startsWith('pub_')) {
      return { sessionId: creds.publicSessionId };
    }
    const newId = 'pub_' + crypto.randomBytes(16).toString('hex');
    const isSecure = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
    const setCookieHeader = `wildguard_public_session=${newId}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000${isSecure ? '; Secure' : ''}`;
    return { sessionId: newId, setCookieHeader };
  }

  /**
   * Distributed Rate Limiting backed by Redis
   */
  public async checkRateLimitAsync(
    identifier: string,
    budgetManager?: any,
    maxRequestsPerMin = 20
  ): Promise<{ allowed: boolean; remaining: number; retryAfterSeconds?: number }> {
    if (budgetManager && typeof budgetManager.incrWithExpiry === 'function' && budgetManager.isConfigured?.()) {
      try {
        const key = `wildguard:ratelimit:${identifier}`;
        const count = await budgetManager.incrWithExpiry(key, 60);
        if (count > maxRequestsPerMin) {
          return { allowed: false, remaining: 0, retryAfterSeconds: 60 };
        }
        return { allowed: true, remaining: Math.max(0, maxRequestsPerMin - count) };
      } catch {
        // Fall back gracefully if Redis rate-limiting fails
      }
    }
    return { allowed: true, remaining: maxRequestsPerMin };
  }

  /**
   * Resolves a stable, non-secret session identity from the request (CRIT-2 & HIGH-2)
   */
  public resolveSessionIdentity(req: IncomingMessage): string {
    const creds = this.extractCredentials(req);
    if (creds.sessionToken) {
      const parts = creds.sessionToken.trim().split(':');
      if (parts.length === 5) {
        return `sess_${parts[1]}`;
      }
    }
    const direct = creds.bearerToken || creds.directToken;
    if (direct) {
      const hash = crypto.createHash('sha256').update(direct).digest('hex').substring(0, 16);
      return `bearer_${hash}`;
    }
    if (creds.publicSessionId) {
      return `pub_${creds.publicSessionId.replace(/^pub_/, '')}`;
    }
    return 'pub_anonymous';
  }

  /**
   * Determine if incoming request is authorized
   */
  public isAuthorized(req: IncomingMessage): { authorized: boolean; reason?: string } {
    // If no access token is configured, live inference fails closed, simulation mode allows
    if (!this.hasAccessToken()) {
      return { authorized: false, reason: 'WILDGUARD_ACCESS_TOKEN is not configured on server' };
    }

    const creds = this.extractCredentials(req);

    // 1. Valid session token?
    if (creds.sessionToken) {
      const sessionRes = this.verifySession(creds.sessionToken);
      if (sessionRes.valid) return { authorized: true };
    }

    // 2. Direct access token match?
    const directCandidate = creds.bearerToken || creds.directToken;
    if (directCandidate && this.verifyAccessToken(directCandidate)) {
      return { authorized: true };
    }

    return { authorized: false, reason: 'Unauthorized: valid session cookie or access token required.' };
  }

  /**
   * Determine if incoming request is authorized, validating against Redis revocation store
   */
  public async isAuthorizedAsync(req: IncomingMessage, budgetManager?: any): Promise<{ authorized: boolean; reason?: string }> {
    if (!this.hasAccessToken()) {
      return { authorized: false, reason: 'WILDGUARD_ACCESS_TOKEN is not configured on server' };
    }

    const creds = this.extractCredentials(req);

    // 1. Valid session token?
    if (creds.sessionToken) {
      const sessionRes = await this.verifySessionAsync(creds.sessionToken, budgetManager);
      if (sessionRes.valid) return { authorized: true };
    }

    // 2. Direct access token match?
    const directCandidate = creds.bearerToken || creds.directToken;
    if (directCandidate && this.verifyAccessToken(directCandidate)) {
      return { authorized: true };
    }

    return { authorized: false, reason: 'Unauthorized: valid session cookie or access token required.' };
  }

  /**
   * Return clearing cookie header
   */
  public clearSessionCookie(): string {
    const isSecure = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
    return `wildguard_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${isSecure ? '; Secure' : ''}`;
  }
}
