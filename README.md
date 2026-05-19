# LEIA Docs

Documentation and API reference for LEIA Partner API integrations.

[![skills.sh](https://skills.sh/b/dasomx/leia-docs)](https://skills.sh/dasomx/leia-docs)

## Agent skill

This repository includes an installable agent skill for LEIA Partner API workflows:

```txt
.agents/skills/leia-api-access/SKILL.md
```

Install from GitHub with the `skills` CLI:

```bash
npx skills add dasomx/leia-docs --skill leia-api-access
```

## Development

Run the development server:

```bash
pnpm dev
```

Open http://localhost:3000.

## Content

- `content/docs/` — Fumadocs MDX documentation
- `openapi.json` / `openapi.yaml` — LEIA Partner API OpenAPI spec
- `.agents/skills/leia-api-access/` — installable API workflow skill
