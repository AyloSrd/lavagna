import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
	files: 'out/test/**/*.test.js',
	// A real workspace folder, because the paste provider only offers a reference
	// when the copy source resolves to one (`getWorkspaceFolder`). Without this
	// the copy → paste test can't exercise the feature at all. Other suites use
	// in-memory documents and are unaffected.
	workspaceFolder: './src/test/fixtures/paste-workspace',
	// Pinned, not 'stable': VS Code 1.131 ships only a `Code` binary, while the
	// installed @vscode/test-electron still spawns `Electron` (ENOENT). Pinning
	// also keeps runs reproducible instead of shifting under every VS Code release.
	version: '1.130.0',
});
