import { describe, it, expect } from 'vitest';
import { resumeCommand } from '../../src/domain/resume-command';

describe('resumeCommand', () => {
  it('builds the Claude resume command from a claude session id', () => {
    expect(resumeCommand({ tool: 'claude', claudeSessionId: 'abc-123' }))
      .toBe('claude --resume abc-123');
  });
  it('builds the Codex resume command from a codex session id', () => {
    expect(resumeCommand({ tool: 'codex', codexSessionId: '4a1f-uuid' }))
      .toBe('codex resume 4a1f-uuid');
  });
  it('returns null for a claude session with no id', () => {
    expect(resumeCommand({ tool: 'claude' })).toBeNull();
  });
  it('returns null for a codex session with no id', () => {
    expect(resumeCommand({ tool: 'codex' })).toBeNull();
  });
  it('ignores a wrong-tool id (codex session carrying only a claude id)', () => {
    expect(resumeCommand({ tool: 'codex', claudeSessionId: 'abc-123' })).toBeNull();
  });
});
