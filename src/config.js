/** Build-time constants. */

/* global __APP_VERSION__ */
export const VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'

/**
 * The commit this bundle was built from, short. See `buildId` in vite.config.js
 * for why `VERSION` could not do this job.
 */
/* global __BUILD_ID__ */
export const BUILD_ID = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev'
