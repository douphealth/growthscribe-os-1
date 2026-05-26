# Contributing to GrowthScribe OS

Thank you for your interest in contributing! This document will help you get started.

## How to Contribute

### Reporting Issues

- Use the [GitHub Issues](https://github.com/growthscribe/growthscribe-os/issues) page to report bugs or request features.
- Search existing issues before creating a new one.
- Include clear reproduction steps for bugs.

### Submitting Changes

1. Fork the repository.
2. Create a new branch: `git checkout -b feature/my-feature` or `fix/my-fix`.
3. Make your changes and ensure tests pass: `bun run check`.
4. Commit with a clear message describing the change.
5. Push to your fork and open a Pull Request.

### Development Setup

```bash
bun install
cp .env.example .env   # then fill in values
bun run dev
```

Run the full check before pushing:

```bash
bun run check          # typecheck + lint
bun run test           # Vitest suite
```

### Code Style

- TypeScript strict mode is enforced.
- Use the existing shadcn/ui and Tailwind patterns for UI components.
- Server functions go in `src/lib/*.functions.ts`.
- Routes go in `src/routes/` following TanStack Start conventions.
- Add tests for new business logic.

### Commit Messages

Use clear, descriptive commit messages:

```
feat: add forecast dashboard
fix: resolve race condition in job queue
docs: update README with setup steps
```

## Questions?

Open a discussion or reach out in issues. We're happy to help!
