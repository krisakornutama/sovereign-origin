import express, { type Express } from 'express';
import { authenticate } from '../middleware/auth.middleware';

// The global parser runs before authentication. Keep the large limit scoped to
// the one endpoint that imports full Export & Clone packages. That large parser
// must also run *after* authentication: otherwise an anonymous request can make
// the process buffer 25 MB before the route ever checks the token (memory DoS).
export const GLOBAL_JSON_LIMIT = '1mb';
export const CLONE_IMPORT_JSON_LIMIT = '25mb';

export function applyJsonBodyParsers(app: Express): void {
  // Stripe webhook — signature is computed over the raw bytes, so this parser
  // must run before the global JSON parser.
  app.use('/api/payments/webhook', express.raw({ type: 'application/json', limit: '256kb' }));

  // Export & Clone import may legitimately be large. Auth first, parse second
  // (the route's own `authenticate` is a no-op once req.user is already set).
  app.use('/api/clone/import', authenticate, express.json({ limit: CLONE_IMPORT_JSON_LIMIT }));

  app.use(express.json({ limit: GLOBAL_JSON_LIMIT }));
}
