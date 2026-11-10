# Playwright Test Portal

A self-service web portal that lets non-developers record browser interactions and convert them into Playwright test cases — automatically committed to your repo and picked up by your CI/CD pipeline.

## What It Does

1. User opens the portal and clicks **"Record New Test"**
2. Enters a URL and test name
3. Backend launches Playwright Codegen in a real browser
4. User performs actions; codegen captures every interaction
5. User stops recording → generated Playwright code is shown in the UI
6. User can add assertions via dropdown (verify text, element visible, URL, etc.)
7. Click **"Save Test"** → file is written to `tests/`, optionally committed to Git
8. CI pipeline picks up the new test on next run

## Architecture

```
┌─────────────────┐      ┌─────────────────┐      ┌──────────────────┐
│   React UI      │─────▶│  Express API    │─────▶│ Playwright       │
│   (port 5173)   │◀─────│  (port 3001)    │◀─────│ Codegen Process  │
└─────────────────┘      └─────────────────┘      └──────────────────┘
                                  │
                                  ▼
                         ┌─────────────────┐
                         │  tests/*.spec.ts│──▶ Git ──▶ CI Pipeline
                         └─────────────────┘
```

## Quick Start

### Prerequisites
- Node.js 18+
- npm or yarn

### Install

```bash
# Backend
cd backend
npm install
npx playwright install chromium

# Frontend
cd ../frontend
npm install
```

### Run

In one terminal:
```bash
cd backend && npm start
```

In another terminal:
```bash
cd frontend && npm run dev
```

Open http://localhost:5173 in your browser.

## How Recording Works

The backend spawns `npx playwright codegen` which opens a real browser window on the machine running the backend. As the user interacts with the page, Playwright streams generated code back to our API. When the user clicks "Stop," we read the saved file, post-process it (add proper test structure, fixtures, assertions), and present it in the UI.

> **Note for production:** For a true browser-based experience where users don't need anything installed locally, swap the local codegen for a cloud browser service like Browserbase or Steel, then stream the browser via WebSocket/noVNC to the user's browser. The recording API is the same.

## CI/CD Integration

The `tests/` folder is your test suite. Configure your pipeline (GitHub Actions, GitLab CI, Jenkins) to:

1. Watch for changes in `tests/`
2. Run `npx playwright test` on every push/PR
3. Upload HTML reports as artifacts

See `.github/workflows/playwright.yml` for an example.

## Roadmap Ideas

- [ ] AI-powered assertion suggestions (use Claude API to analyze the recording and suggest meaningful checks)
- [ ] Auto-replace fragile selectors with `getByRole`, `getByTestId`
- [ ] Test versioning + diff viewer
- [ ] One-click "Run Test" from the UI with live results
- [ ] Multi-environment support (dev, staging, prod URLs as env vars)
- [ ] Team workspaces with role-based access
