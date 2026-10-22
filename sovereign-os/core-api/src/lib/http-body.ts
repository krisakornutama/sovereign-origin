import express, { type Express } from 'express';

// The global parser runs before authentication. Keep the large limit scoped to
// the one endpoint that imports full Export & Clone packages; every other JSON
// endpoint (including public login/health) must stay small.
export const GLOBAL_JSON_LIMIT = '1mb';
export const CLONE_IMPORT_JSON_LIMIT = '25mb';

export function applyJsonBodyParsers(app: Express): void {
  // Stripe webhook — signature is computed over the raw bytes, so this parser
  // must run before the global JSON parser.
  app.use('/api/payments/webhook', express.raw({ type: 'application/json', limit: '256kb' }));

  // Export & Clone import may legitimately be large. The path-level parser
  // marks the body as parsed, so the 1 MB global parser skips it afterwards.
  app.use('/api/clone/import', express.json({ limit: CLONE_IMPORT_JSON_LIMIT }));

  app.use(express.json({ limit: GLOBAL_JSON_LIMIT }));
}
