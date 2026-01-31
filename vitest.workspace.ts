import { defineWorkspace } from 'vitest/config';

/**
 * Vitest workspace configuration for ComplianceIQ monorepo
 *
 * This allows running tests across all packages and apps from the root.
 */
export default defineWorkspace(['apps/*', 'packages/*']);
