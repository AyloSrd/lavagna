const esbuild = require("esbuild");
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').Plugin} */
const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',
	setup(build) {
		build.onStart(() => {
			console.log('[watch] build started');
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				console.error(`    ${location.file}:${location.line}:${location.column}:`);
			});
			console.log('[watch] build finished');
		});
	},
};

const sharedOptions = {
	bundle: true,
	minify: production,
	sourcemap: !production,
	sourcesContent: false,
	logLevel: 'silent',
	plugins: [esbuildProblemMatcherPlugin],
};

// The skills Lavagna ships live at the repo root (/skills) so that
// `npx skills add` and the Claude Code marketplace find them. The extension
// installs them from its own bundle, so they are copied in at build time
// (apps/extension/skills/, gitignored, included in the .vsix).
//
// Only files git tracks are copied: the marketplace and `npx skills add` serve
// /skills from git, so the .vsix carries exactly that — never a draft or a
// notes file that happens to sit in the working tree. A .vsix is public and,
// once published, permanent. scripts/check-vsix.mjs verifies the same set
// from the package side.
function copySkills() {
	const repoRoot = path.resolve(__dirname, '..', '..');
	const from = path.join(repoRoot, 'skills');
	const to = path.resolve(__dirname, 'skills');
	// Check before deleting. If `from` is missing — a source tarball of
	// apps/extension alone, a bad checkout, someone moving /skills — the delete
	// would already have happened and the copy would throw an opaque ENOENT,
	// leaving the previously-good copy gone.
	if (!fs.existsSync(from)) {
		throw new Error(
			`copySkills: ${from} not found — run the build from the monorepo root; ` +
			`the skills are the single source of truth at /skills and are copied in at build time.`
		);
	}
	const tracked = trackedSkillFiles(repoRoot);
	for (const file of tracked) {
		const stat = fs.lstatSync(path.join(repoRoot, ...file.split('/')), { throwIfNoEntry: false });
		if (!stat || !stat.isFile()) {
			throw new Error(
				`copySkills: ${file} is tracked by git but is ${stat ? 'not a regular file' : 'missing from the working tree'} — ` +
				`restore it (git checkout -- ${file}) or remove it from git before building.`
			);
		}
	}
	fs.rmSync(to, { recursive: true, force: true });
	for (const file of tracked) {
		const segments = file.split('/');
		const dst = path.join(to, ...segments.slice(1));
		// Plain mkdir + copyFile rather than fs.cpSync: cpSync preserves
		// directory modes, which some mounted filesystems refuse.
		fs.mkdirSync(path.dirname(dst), { recursive: true });
		fs.copyFileSync(path.join(repoRoot, ...segments), dst);
	}
}

/** `git ls-files -z -- skills`: '/'-separated paths, each starting with `skills/`. Throws when git can't answer. */
function trackedSkillFiles(repoRoot) {
	let out;
	try {
		// argv array, no shell: nothing is interpolated into a command line.
		out = execFileSync('git', ['ls-files', '-z', '--', 'skills'], {
			cwd: repoRoot,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe'],
		});
	} catch (error) {
		throw new Error(
			`copySkills: \`git ls-files -- skills\` failed in ${repoRoot} (${String(error.message).trim()}). ` +
			`The build copies only git-tracked skill files, so it needs git and a git checkout of the monorepo.`
		);
	}
	const files = out.split('\0').filter(Boolean);
	if (!files.includes('skills/manifest.json')) {
		throw new Error(
			`copySkills: git tracks ${files.length === 0 ? 'nothing' : 'no skills/manifest.json'} under ${path.join(repoRoot, 'skills')} — ` +
			`refusing to build an extension without its skills.`
		);
	}
	return files;
}

// Same rule for the brand assets: packages/brand/exports/ is the single source
// of truth, and the two files the .vsix needs are copied in at build time
// (gitignored destinations). @lavagna/brand is a workspace devDependency purely
// so Turbo runs its build first — nothing is imported from it.
function copyBrand() {
	const from = path.resolve(__dirname, '..', '..', 'packages', 'brand', 'exports');
	const pairs = [
		['icon-256.png', 'icon.png'],
		['activity-bar.svg', 'spiral.svg'],
	];
	for (const [src, dst] of pairs) {
		const source = path.join(from, src);
		if (!fs.existsSync(source)) {
			throw new Error(`packages/brand/exports/${src} is missing — run \`pnpm --filter @lavagna/brand run build\` (Turbo does this for you).`);
		}
		fs.copyFileSync(source, path.resolve(__dirname, 'media', dst));
	}
}

async function main() {
	copySkills();
	copyBrand();
	const extensionCtx = await esbuild.context({
		...sharedOptions,
		entryPoints: ['src/extension.ts'],
		format: 'cjs',
		platform: 'node',
		outfile: 'dist/extension.js',
		external: ['vscode'],
	});

	const webviewCtx = await esbuild.context({
		...sharedOptions,
		entryPoints: ['src/webview/index.tsx'],
		format: 'iife',
		platform: 'browser',
		outfile: 'media/webview.js',
		jsx: 'automatic',
		loader: { '.css': 'text' },
	});

	if (watch) {
		await Promise.all([extensionCtx.watch(), webviewCtx.watch()]);
	} else {
		await Promise.all([extensionCtx.rebuild(), webviewCtx.rebuild()]);
		await Promise.all([extensionCtx.dispose(), webviewCtx.dispose()]);
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
