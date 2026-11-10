/**
 * Playwright Test Portal — Backend API
 *
 * Endpoints:
 *   POST /api/record/start   → launches Playwright codegen
 *   POST /api/record/stop    → stops codegen, returns generated code
 *   POST /api/tests/save     → saves a test file to disk (+ optional git commit)
 *   GET  /api/tests          → lists existing tests
 *   GET  /api/tests/:name    → fetches a single test file
 *   POST /api/tests/:name/run → runs a single test, returns results
 *   DELETE /api/tests/:name  → deletes a test file
 */

const express = require("express");
const cors = require("cors");
const { spawn, exec } = require("child_process");
const fs = require("fs");
const path = require("path");
const { promisify } = require("util");

const execAsync = promisify(exec);
const app = express();
const PORT = process.env.PORT || 3001;

// Where generated tests live — this is the folder your CI pipeline watches.
const TESTS_DIR = path.join(__dirname, "..", "tests");
if (!fs.existsSync(TESTS_DIR)) fs.mkdirSync(TESTS_DIR, { recursive: true });

// In-memory store of active recording sessions.
// In production, use Redis or a DB so sessions survive restarts.
const sessions = new Map();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

// ─── Helpers ──────────────────────────────────────────────────────────────

function sanitizeTestName(name) {
  // Strip anything that isn't safe for a filename.
  return name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
}

function wrapInTestStructure(rawCode, testName, description) {
  // Playwright codegen output already includes the test wrapper when
  // --target=playwright-test is used, but we normalize the structure here
  // and add a meaningful description.
  if (rawCode.includes("test(") || rawCode.includes("test.describe(")) {
    return rawCode;
  }

  // Fallback: wrap a bare recording (rare, but possible if codegen failed).
  return `import { test, expect } from '@playwright/test';

test.describe('${description || testName}', () => {
  test('${testName}', async ({ page }) => {
${rawCode
  .split("\n")
  .map((line) => "    " + line)
  .join("\n")}
  });
});
`;
}

function applyAssertions(code, assertions) {
  // Insert user-defined assertions before the final closing brace.
  if (!assertions || assertions.length === 0) return code;

  const assertionLines = assertions
    .map((a) => {
      switch (a.type) {
        case "visible":
          return `  await expect(page.locator('${a.selector}')).toBeVisible();`;
        case "text":
          return `  await expect(page.locator('${a.selector}')).toHaveText('${a.value}');`;
        case "url":
          return `  await expect(page).toHaveURL('${a.value}');`;
        case "title":
          return `  await expect(page).toHaveTitle('${a.value}');`;
        case "count":
          return `  await expect(page.locator('${a.selector}')).toHaveCount(${a.value});`;
        default:
          return `  // unknown assertion: ${JSON.stringify(a)}`;
      }
    })
    .join("\n");

  // Inject before the last `});` — works for both wrapped and bare scripts.
  const lastBrace = code.lastIndexOf("});");
  if (lastBrace === -1) return code + "\n" + assertionLines;

  return (
    code.slice(0, lastBrace) + assertionLines + "\n" + code.slice(lastBrace)
  );
}

// ─── Routes ───────────────────────────────────────────────────────────────

/**
 * Start a recording session.
 * Launches Playwright codegen, which opens a headed browser + inspector.
 * The user interacts; codegen writes generated code to a temp file.
 */
app.post("/api/record/start", (req, res) => {
  const { url, testName, browser = "chromium" } = req.body;

  if (!url || !testName) {
    return res.status(400).json({ error: "url and testName are required" });
  }

  const safeName = sanitizeTestName(testName);
  const sessionId = `${safeName}_${Date.now()}`;
  const outputPath = path.join(TESTS_DIR, `.recording_${sessionId}.spec.js`);

  // Spawn Playwright codegen as a child process.
  // The --target flag controls the output language/framework.
  const codegen = spawn(
    "npx",
    [
      "playwright",
      "codegen",
      url,
      "--browser",
      browser,
      "--target",
      "playwright-test",
      "--output",
      outputPath,
    ],
    { stdio: "pipe" },
  );

  let stderr = "";
  codegen.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  codegen.on("error", (err) => {
    console.error("Codegen spawn error:", err);
  });

  sessions.set(sessionId, {
    process: codegen,
    outputPath,
    testName: safeName,
    url,
    startedAt: Date.now(),
    stderr: () => stderr,
  });

  console.log(`[record] started session ${sessionId} → ${outputPath}`);

  res.json({
    sessionId,
    message:
      "Recording started. A browser window has opened — interact with the page, then call /record/stop.",
  });
});

/**
 * Stop a recording session.
 * Kills the codegen process and reads the generated code from disk.
 */
app.post("/api/record/stop", async (req, res) => {
  const { sessionId } = req.body;
  const session = sessions.get(sessionId);

  if (!session) {
    return res
      .status(404)
      .json({ error: "Session not found or already stopped" });
  }

  // Gracefully terminate codegen. It flushes the file on SIGTERM.
  try {
    session.process.kill("SIGTERM");
  } catch (err) {
    console.warn("Kill error (likely already exited):", err.message);
  }

  // Give the OS a beat to flush the file.
  await new Promise((r) => setTimeout(r, 500));

  let code = "";
  try {
    code = fs.readFileSync(session.outputPath, "utf-8");
    fs.unlinkSync(session.outputPath); // clean up the temp file
  } catch (err) {
    console.error("Failed to read recording:", err);
    return res.status(500).json({
      error:
        "Could not read recording output. Did you interact with the browser?",
      stderr: session.stderr(),
    });
  }

  sessions.delete(sessionId);

  res.json({
    sessionId,
    testName: session.testName,
    code,
    durationMs: Date.now() - session.startedAt,
  });
});

/**
 * Save a finalized test to disk.
 * Optionally commits to git so the CI pipeline picks it up.
 */
app.post("/api/tests/save", async (req, res) => {
  const {
    testName,
    code,
    description,
    assertions,
    commitToGit = false,
  } = req.body;

  if (!testName || !code) {
    return res.status(400).json({ error: "testName and code are required" });
  }

  const safeName = sanitizeTestName(testName);
  const filePath = path.join(TESTS_DIR, `${safeName}.spec.js`);

  let finalCode = wrapInTestStructure(code, safeName, description);
  finalCode = applyAssertions(finalCode, assertions);

  // Add a header comment so anyone reading the file knows it was portal-generated.
  const header =
    `// Generated by Playwright Test Portal on ${new Date().toISOString()}\n` +
    `// Test: ${safeName}\n` +
    (description ? `// Description: ${description}\n` : "") +
    `\n`;

  fs.writeFileSync(filePath, header + finalCode, "utf-8");

  let gitResult = null;
  if (commitToGit) {
    try {
      await execAsync(`git add "${filePath}"`, {
        cwd: path.join(__dirname, ".."),
      });
      await execAsync(`git commit -m "Add test: ${safeName} (via portal)"`, {
        cwd: path.join(__dirname, ".."),
      });
      gitResult = "committed";
    } catch (err) {
      gitResult = `git error: ${err.message}`;
    }
  }

  res.json({
    saved: true,
    path: filePath,
    relativePath: `tests/${safeName}.spec.ts`,
    git: gitResult,
  });
});

/**
 * List existing tests in the tests/ folder.
 */
app.get("/api/tests", (req, res) => {
  const files = fs
    .readdirSync(TESTS_DIR)
    .filter((f) => f.endsWith(".spec.js") && !f.startsWith("."))
    .map((f) => {
      const stat = fs.statSync(path.join(TESTS_DIR, f));
      return {
        name: f.replace(".spec.js", ""),
        file: f,
        size: stat.size,
        modified: stat.mtime,
      };
    })
    .sort((a, b) => b.modified - a.modified);

  res.json({ tests: files });
});

/**
 * Fetch a single test's source.
 */
app.get("/api/tests/:name", (req, res) => {
  const safeName = sanitizeTestName(req.params.name);
  const filePath = path.join(TESTS_DIR, `${safeName}.spec.js`);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "Test not found" });
  }

  const code = fs.readFileSync(filePath, "utf-8");
  res.json({ name: safeName, code });
});

/**
 * Run a single test and stream back the result.
 * For a polished UX, swap this for SSE/WebSocket streaming.
 */
app.post("/api/tests/:name/run", async (req, res) => {
  const safeName = sanitizeTestName(req.params.name);
  const filePath = path.join(TESTS_DIR, `${safeName}.spec.js`);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "Test not found" });
  }

  try {
    const { stdout, stderr } = await execAsync(
      `npx playwright test "${filePath}" --reporter=line`,
      { cwd: path.join(__dirname, ".."), timeout: 120000 },
    );
    res.json({ passed: true, stdout, stderr });
  } catch (err) {
    res.json({
      passed: false,
      stdout: err.stdout || "",
      stderr: err.stderr || err.message,
    });
  }
});

/**
 * Delete a test.
 */
app.delete("/api/tests/:name", (req, res) => {
  const safeName = sanitizeTestName(req.params.name);
  const filePath = path.join(TESTS_DIR, `${safeName}.spec.js`);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "Test not found" });
  }

  fs.unlinkSync(filePath);
  res.json({ deleted: true, name: safeName });
});

// ─── Boot ─────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(
    `\n  Playwright Test Portal — backend running on http://localhost:${PORT}`,
  );
  console.log(`  Tests directory: ${TESTS_DIR}\n`);
});
