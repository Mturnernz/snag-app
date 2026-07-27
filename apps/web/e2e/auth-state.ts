import path from 'node:path';

// Where auth.setup.ts saves the supervisor session and the portal specs read it
// from. Its own module because Playwright refuses to let a spec import a setup
// file, and both sides need to agree on the path.
export const SUPERVISOR_STATE = path.join(__dirname, '.auth/supervisor.json');
