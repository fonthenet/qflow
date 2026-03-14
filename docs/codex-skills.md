# Codex Skills For The SaaS Rebuild

These skills were installed locally for the QueueFlow SaaS rebuild:

- `playwright`
- `screenshot`
- `vercel-deploy`
- `security-best-practices`
- `security-threat-model`

## Important

Codex skills are local machine assets. They do not live inside the git repository by default, so they cannot be "pushed" the same way application code is pushed.

To continue this rebuild on another machine, install the same skills there and restart Codex.

## Install Commands

Run these from a machine that already has Codex available:

```bash
python3 /Users/pc/.codex/skills/.system/skill-installer/scripts/install-skill-from-github.py --repo openai/skills --path skills/.curated/playwright
python3 /Users/pc/.codex/skills/.system/skill-installer/scripts/install-skill-from-github.py --repo openai/skills --path skills/.curated/screenshot
python3 /Users/pc/.codex/skills/.system/skill-installer/scripts/install-skill-from-github.py --repo openai/skills --path skills/.curated/vercel-deploy
python3 /Users/pc/.codex/skills/.system/skill-installer/scripts/install-skill-from-github.py --repo openai/skills --path skills/.curated/security-best-practices
python3 /Users/pc/.codex/skills/.system/skill-installer/scripts/install-skill-from-github.py --repo openai/skills --path skills/.curated/security-threat-model
```

## Windows Note

On Windows, the exact Codex home path may differ from `/Users/pc/.codex`. Use the same skill names, then restart Codex so they become available in future turns.
