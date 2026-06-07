# Verify Export Script Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `scripts/verify-export.js` Playwright script that starts the dev server, clicks Export PNG, and saves the result to `scripts/last-export.png` for visual verification.

**Architecture:** A standalone Node.js script that spawns `pnpm dev`, waits for Vite to be ready, uses Playwright to navigate to the app, intercepts the file download triggered by clicking the Export PNG button, and saves it locally. No test framework needed — this is a dev utility.

**Tech Stack:** Node.js (ESM), `@playwright/test` (browser automation + download interception), `pnpm dev` (Vite dev server)

---

### Task 1: Install Playwright

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install Playwright as devDependency**

```bash
cd /home/franco/Escritorio/facu/tpp/lsp-server-client-test/lsp-client/dependency-graph
pnpm add -D @playwright/test
npx playwright install chromium
```

Expected: Playwright installs and Chromium downloads to `~/.cache/ms-playwright/`.

- [ ] **Step 2: Add verify-export script to package.json**

In `package.json`, inside `"scripts"`:
```json
"verify-export": "node scripts/verify-export.js"
```

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add Playwright for verify-export script"
```

---

### Task 2: Write verify-export.js

**Files:**
- Create: `scripts/verify-export.js`

- [ ] **Step 1: Create the script**

```js
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(__dirname, 'last-export.png');

async function waitForVite(proc, timeoutMs = 30000) {
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

  await page.goto('http://localhost:5173');
  await page.waitForSelector('canvas', { timeout: 15000 });
  // Extra wait for Cytoscape layout to settle
  await page.waitForTimeout(2000);

  console.log('Clicking Export PNG...');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('button.export-btn'),
  ]);

  const buffer = await download.createReadStream().then(
    (stream) =>
      new Promise((res, rej) => {
        const chunks = [];
        stream.on('data', (c) => chunks.push(c));
        stream.on('end', () => res(Buffer.concat(chunks)));
        stream.on('error', rej);
      })
  );

  writeFileSync(OUT_PATH, buffer);
  console.log(`PNG saved to: ${OUT_PATH}`);

  await browser.close();
} finally {
  dev.kill();
}
```

- [ ] **Step 2: Run the script**

```bash
cd /home/franco/Escritorio/facu/tpp/lsp-server-client-test/lsp-client/dependency-graph
pnpm verify-export
```

Expected output:
```
Starting dev server...
Dev server ready.
Clicking Export PNG...
PNG saved to: .../scripts/last-export.png
```

- [ ] **Step 3: View the output PNG and confirm it looks correct**

Read `scripts/last-export.png` visually and check:
- Nodes are distributed in a grid (not a single line)
- Labels are legible

- [ ] **Step 4: Commit**

```bash
git add scripts/verify-export.js package.json pnpm-lock.yaml
git commit -m "chore: add verify-export Playwright script"
```
