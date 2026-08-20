/**
 * The shared password every seeded account uses (D-5).
 *
 * Here rather than in `infra/seed/` because two things need it and they are on
 * opposite sides of the application: the seed script sets it, and the sign-in
 * page prints it. Importing the seed module into a page would drag the whole
 * import — Better Auth, every repository, the prototype fixtures — into a
 * screen that needs one string.
 *
 * This is only safe because of what this deployment is: a demonstration over
 * fixtures for a firm that does not exist, with sign-up closed and every
 * account provisioned by the seed. A real deployment would remove this file and
 * the panel that reads it, and issue credentials the way ADR 0004 assumes.
 */
export const DEMO_PASSWORD = "oklaw-demo-2026";
