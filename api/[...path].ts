/// <reference path="../server/src/types/express.d.ts" />
import type { IncomingMessage, ServerResponse } from 'node:http';
import { vercelApp } from '../server/src/vercel.js';

const handleExpressRequest = vercelApp as unknown as (
  request: IncomingMessage,
  response: ServerResponse,
) => void;

/**
 * Vercel catch-all Node.js Function for every /api/* endpoint.
 * The Express application remains the owner of the route definitions.
 */
export default function handler(
  request: IncomingMessage,
  response: ServerResponse,
): void {
  handleExpressRequest(request, response);
}
