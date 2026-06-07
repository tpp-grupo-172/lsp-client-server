import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(__dirname, 'last-export.png');

// Load mock data from source
const { mockTreeSitterData } = await import('../src/lib/mockDataMidProject.js');

function waitForVite(proc, timeoutMs = 30000) {
	return new Promise((res, rej) => {
		const t = setTimeout(() => rej(new Error('Vite did not start in time')), timeoutMs);
		proc.stdout.on('data', (chunk) => {
			if (chunk.toString().includes('Local:')) {
				clearTimeout(t);
				res();
			}
		});
		proc.stderr.on('data', (chunk) => process.stderr.write(chunk));
	});
}

const dev = spawn('pnpm', ['dev'], {
	cwd: resolve(__dirname, '..'),
	stdio: ['ignore', 'pipe', 'pipe'],
});

try {
	console.log('Starting dev server...');
	await waitForVite(dev);
	console.log('Dev server ready.');

	const browser = await chromium.launch();
	const context = await browser.newContext({ acceptDownloads: true });
	const page = await context.newPage();
	page.on('console', (msg) => { if (msg.type() === 'error') console.error('[page]', msg.text()); });

	await page.goto('http://localhost:5173');
	await page.waitForTimeout(500);

	// Inject mock data as if it came from the VSCode extension
	await page.evaluate((files) => {
		window.dispatchEvent(new MessageEvent('message', {
			data: { command: 'lsp-server/processedJson', files },
		}));
	}, mockTreeSitterData.files);

	await page.waitForSelector('button.export-btn', { timeout: 20000 });
	// Wait for Cytoscape layout to settle
	await page.waitForTimeout(3000);

	console.log('Clicking Export PNG...');
	const [download] = await Promise.all([
		page.waitForEvent('download'),
		page.click('button.export-btn'),
	]);

	const stream = await download.createReadStream();
	const buffer = await new Promise((res, rej) => {
		const chunks = [];
		stream.on('data', (c) => chunks.push(c));
		stream.on('end', () => res(Buffer.concat(chunks)));
		stream.on('error', rej);
	});

	writeFileSync(OUT_PATH, buffer);
	console.log(`PNG saved to: ${OUT_PATH}`);

	await browser.close();
} finally {
	dev.kill();
}
