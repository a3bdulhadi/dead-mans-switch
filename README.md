# Dead Man's Switch — Cryptographic Evidence Escrow & Autonomous Release Protocol

A censorship-resistant, three-tier **Dead Man's Switch** engineered to protect whistleblowers, journalists, and high-risk individuals. Sensitive files are encrypted client-side with **AES-256-GCM**, anchored on-chain via **Solidity smart contracts**, maintained through **offline EIP-712 signed heartbeats** (including a **silent duress signal**), and automatically released by an **autonomous Node.js watcher & relayer agent** if the owner goes silent for 5 days.

---

## System Architecture

```text
┌─────────────────────────────┐      HTTP Bridge (127.0.0.1:8787)      ┌──────────────────────────────────┐
│     Offline-First PWA       │ ─────────────────────────────────────► │   Autonomous Release Agent       │
│  (pwa/index.html + WebCrypto)│   POST /escrow  |  POST /relay        │  (agent/watcher.js + relayer)    │
│  - AES-256-GCM File Sealing │   GET  /status  |  GET  /release      │  - Exponential RPC Retry         │
│  - EIP-712 Packet Signing   │   (Bearer Auth + Rate Limiting)        │  - Duplicate Packet Filtering    │
└──────────────┬──────────────┘                                        │  - Telegram + Console Notifier   │
               │                                                       └────────────────┬─────────────────┘
               │ Direct RPC (Optional)                                                  │ JSON-RPC (8545)
               ▼                                                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                  Ethereum / Hardhat Smart Contract Layer                                │
│                                    (contracts/contracts/DeadMansSwitch.sol)                             │
│   Stage 0: SAFE (< 2 Days)  ──►  Stage 1: ALERT (2–5 Days)  ──►  Stage 2: RELEASED (>= 5 Days Latched)   │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────┘