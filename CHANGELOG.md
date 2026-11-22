# Changelog

All notable changes to the **Dead Man's Switch** protocol are documented in this file.

## [1.0.0] - 2026-11-22

### Smart Contracts (`contracts/`)
- Implemented `DeadMansSwitch.sol` with a deterministic three-stage inactivity state machine (`SAFE` < 2 days, `ALERT` 2–5 days, `RELEASED` >= 5 days).
- Added EIP-712 typed offline signature verification (`checkInWithSignature`) with strict monotonic `nonce` replay protection and `deadline` expiry checks.
- Implemented silent coercion protection (`duress` flag) that resets the public stage to `SAFE` while emitting an emergency state signal (`duressTriggered`).
- Added automated artifact synchronization (`scripts/deploy.js`) exporting ABI, contract address, and EIP-712 schema to `agent/shared/` and `pwa/shared/`.

### Autonomous Release Agent (`agent/`)
- Built continuous polling daemon (`watcher.js`) with exponential-backoff RPC retry (`withRpcRetry`), graceful `SIGINT`/`SIGTERM` shutdown, and automatic Day-5 `finalizeRelease()` latching.
- Built offline EIP-712 packet queue processor (`queueRelayer.js`) with SHA-256 duplicate packet filtering and pre-flight validation.
- Built local HTTP PWA Bridge (`bridgeServer.js`) with constant-time Bearer-token authentication (`crypto.timingSafeEqual`), per-IP sliding-window rate limiting, and CORS headers.
- Built AES-256-GCM release bundler (`releaseBuilder.js`) and Telegram/console notification dispatcher (`notifier.js`).
- Added comprehensive offline unit tests, live-node integration suites, security hygiene audit (`auditCheck.js`), and a 5-act narrated presentation demo (`livePresentation.js`).

### Offline-First Progressive Web App (`pwa/`)
- Built zero-knowledge client-side AES-256-GCM file encryption and decryption workflow using WebCrypto.
- Built offline EIP-712 heartbeat signing interface and live contract stage monitor.