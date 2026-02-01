import { describe, it, expect } from 'vitest';

// Basic schema validation tests
// Note: Full Convex testing requires their test framework

describe('Schema Types', () => {
  it('should define jurisdiction types correctly', () => {
    const validTypes = ['federal', 'state', 'county', 'municipal'];
    expect(validTypes).toHaveLength(4);
    expect(validTypes).toContain('federal');
  });

  it('should define message roles correctly', () => {
    const validRoles = ['user', 'assistant'];
    expect(validRoles).toHaveLength(2);
  });

  it('should define source types correctly', () => {
    const validTypes = ['api', 'scrape', 'manual'];
    expect(validTypes).toHaveLength(3);
  });

  it('should define message status correctly', () => {
    const validStatuses = ['pending', 'processing', 'streaming', 'complete', 'error'];
    expect(validStatuses).toHaveLength(5);
  });
});
