/**
 * WildGuard - Vercel Serverless Function Entry Point
 * Supports authenticated live Otari integration or safe simulation mode.
 *
 * Invariants:
 * - Read-only host filesystem strictly enforced (tools.setReadOnly(true))
 * - Public interactive access with ephemeral demo workspace in /tmp
 * - Outbound Otari inference bounded by Upstash Redis budget reservation and per-run caps
 * - Rate limiting (20 req/min) enforced per session
 * - Fails safe to simulation mode if live credentials are not configured
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleWildGuardRequest } from '../src/web/server.js';
import { createWildGuardAgent } from '../src/index.js';

// Instantiate an agent for the serverless container instance from environment variables
const vercelAgent = createWildGuardAgent(process.cwd(), {
  env: process.env,
});

// Strictly enforce read-only tools on Vercel (no disk writes in serverless container)
vercelAgent.tools.setReadOnly(true);

// If in simulation mode or live credentials are absent, operate with preview safeguards active
const isSimulation = vercelAgent.config.mode === 'simulation' || !vercelAgent.config.apiKey;

/**
 * Standard Vercel Serverless Function handler.
 */
export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  return handleWildGuardRequest(req, res, {
    agent: vercelAgent,
    isPublicPreview: isSimulation,
  });
}
