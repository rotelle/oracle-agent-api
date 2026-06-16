# JRTi Oracle Query

Bridge between a cloud reporting application and a local Oracle 10g database on a Windows server.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLOUD (Render)                           │
│                                                                 │
│   ┌─────────────────┐          ┌──────────────────────────┐    │
│   │  Report App     │─────────►│     Next.js API          │    │
│   │  (any origin)   │  POST    │     /api/query           │    │
│   │                 │◄─────────│                          │    │
│   └─────────────────┘  JSON   └──────────┬───────────────┘    │
└───────────────────────────────────────────┼────────────────────┘
                                            │ wss:// WebSocket
┌───────────────────────────────────────────┼────────────────────┐
│                   WINDOWS LOCAL           │                     │
│                                           │                     │
│   ┌───────────────────────────────────────▼───────────────┐    │
│   │              jrti-oracle-query.exe                    │    │
│   │  Go agent — connects to API, executes Oracle queries  │    │
│   └───────────────────────────┬───────────────────────────┘    │
│                               │ TCP local                       │
│   ┌───────────────────────────▼───────────────────────────┐    │
│   │                  Oracle 10g                           │    │
│   └───────────────────────────────────────────────────────┘    │
└────────────────────────────────────────────────────────────────┘
```

## Repository Structure

```
jrti-oracle-query/
├── api/       → Next.js API hosted on Render
└── agent/     → Go agent compiled to .exe for Windows
```

## Quick Start

1. Deploy `api/` to Render — see [api/README.md](api/README.md)
2. Compile and run `agent/` on the Windows server — see [agent/README.md](agent/README.md)

## Documentation

- [SPEC.md](SPEC.md) — functional specification
- [ARCHITECTURE.md](ARCHITECTURE.md) — technical architecture
- [INSTRUCTIONS.md](INSTRUCTIONS.md) — integration guide for the reporting application
