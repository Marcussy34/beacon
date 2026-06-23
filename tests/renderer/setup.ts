// Ensure @testing-library/react cleanup runs after each test in the renderer test suite.
// This is required because the global vitest env is 'node'; the per-file `// @vitest-environment jsdom`
// docblock switches env but @testing-library/react's auto-cleanup must be explicitly wired here.
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => { cleanup(); });
