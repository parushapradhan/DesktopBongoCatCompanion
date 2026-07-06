# Contributing to Bongo Buddy

Thanks for wanting to help out! This is a small, dependency-light project on
purpose — both apps run without a build step, so contributing doesn't require
learning a framework.

## Project layout

- `desktop-app/` — Electron app (Mac/Windows/Linux). `main.js` is the
  process; everything under `renderer/` is plain HTML/CSS/JS.
- `mobile-app/` — a static PWA, no build tooling. Open `index.html` directly
  or serve the folder with any static file server.
- `desktop-app/renderer/bongo-cat.js` and `mobile-app/bongo-cat.js` are kept
  **byte-identical** — the cat animation logic is shared by copy, not by a
  shared module, so the mobile app stays a zero-build static site. If you
  change one, copy the change to the other and diff them before opening a PR.

## Getting set up

```bash
git clone <your fork's URL>
cd bongo-buddy
cp desktop-app/renderer/firebase-config.example.js desktop-app/renderer/firebase-config.js
cp mobile-app/firebase-config.example.js mobile-app/firebase-config.js
```

You'll need your own free Firebase project to test pairing/presence end to
end — see the README's setup section. UI/animation changes that don't touch
Firebase can usually be checked by opening `mobile-app/index.html` straight
in a browser.

Run the desktop app:
```bash
cd desktop-app
npm install
npm start
```

## Making a change

1. Open an issue first for anything non-trivial (new features, behavior
   changes) so we can align on the approach before you put in the work.
   Small fixes and typos can just be a PR.
2. Keep PRs focused — one feature or fix per PR is much easier to review.
3. If you touch `bongo-cat.js`, update **both** copies (see above) and
   mention in the PR description that you diffed them.
4. There's no test suite yet (see "Testing" below) — describe how you
   manually verified the change in the PR description, ideally with a
   screen recording or screenshot for anything visual.
5. Match the existing code style: plain JS (no TypeScript, no framework, no
   build step), comments explaining *why* over *what*, and the existing
   naming conventions (`camelCase`, `SCREAMING_SNAKE_CASE` for constants).

## Testing

There's currently no automated test suite for the animation/UI code — it's
vanilla JS run directly in Electron/a browser, so manual verification is the
norm:
- For `bongo-cat.js` changes, open the app and trigger each state (idle,
  typing at a few speeds, celebrate, error, terminal, poke, duet) and
  confirm the animation looks right.
- For Firebase-backed logic (pairing, presence, events), test with two
  devices/browser tabs connected to the same room code.
- CI (`.github/workflows/ci.yml`) runs `node --check` over all JS files as a
  basic syntax gate on every PR — it won't catch logic bugs, just parse
  errors.

If you're comfortable adding real tests (even a small jsdom-based harness
for `bongo-cat.js`), that would be a very welcome contribution on its own.

## Reporting bugs / requesting features

Use the issue templates under `.github/ISSUE_TEMPLATE/`. Include your OS,
whether it's the desktop or mobile app, and steps to reproduce.

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). Be
kind.
