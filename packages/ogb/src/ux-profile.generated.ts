import { UX_PROFILE_SCHEMA, type UxProfilePreset } from "./ux-profile.js";

export const UX_PROFILE_PRESET = {
  "schema": UX_PROFILE_SCHEMA,
  "name": "default",
  "description": "Default OGB OpenCode UX profile distributed to users.",
  "safePlugins": [
    "opencode-gemini-auth@1.4.12",
    "@ex-machina/opencode-anthropic-auth@1.8.0",
    "opencode-update-notifier@0.1.0",
    "opencode-auto-fallback@0.4.3",
    "opencode-notify",
    "@tarquinen/opencode-dcp@3.1.9",
    "opencode-pty@0.3.4"
  ],
  "disabledPlugins": [
    "opencode-websearch-cited@1.2.0",
    "opencode-auto-fallback@0.4.2"
  ],
  "removedGlobalCommands": [
    "dev-server"
  ],
  "tuiRuntimeDependencies": {
    "@opentui/solid": "0.2.2",
    "solid-js": "1.9.12"
  },
  "globalConfig": {
    "schemaUrl": "https://opencode.ai/config.json",
    "share": "manual",
    "autoupdate": "notify",
    "smallModel": "openai/gpt-5.4-mini",
    "defaultAgent": "YOLO",
    "watcherIgnore": [
      ".git/**",
      "node_modules/**",
      "dist/**",
      "build/**",
      ".venv/**",
      "__pycache__/**",
      ".opencode/generated/**"
    ],
    "toolOutput": {
      "max_lines": 800,
      "max_bytes": 30000
    },
    "compaction": {
      "auto": true,
      "prune": true,
      "tail_turns": 4,
      "preserve_recent_tokens": 12000,
      "reserved": 10000
    },
    "permission": {
      "read": "allow",
      "edit": "ask",
      "glob": "allow",
      "grep": "allow",
      "list": "allow",
      "bash": {
        "*": "ask",
        "git status*": "allow",
        "git diff*": "allow",
        "git log*": "allow",
        "npm run dev*": "allow",
        "npm run build*": "allow",
        "npm test*": "allow",
        "npm run test*": "allow",
        "pnpm dev*": "allow",
        "pnpm run dev*": "allow",
        "pnpm test*": "allow",
        "pnpm run test*": "allow",
        "pnpm build*": "allow",
        "pnpm run build*": "allow",
        "yarn dev*": "allow",
        "yarn run dev*": "allow",
        "yarn test*": "allow",
        "yarn run test*": "allow",
        "yarn build*": "allow",
        "yarn run build*": "allow",
        "bun dev*": "allow",
        "bun run dev*": "allow",
        "bun test*": "allow",
        "bun run test*": "allow",
        "bun run build*": "allow",
        "uv run *": "allow",
        "pytest*": "allow",
        "python -m pytest*": "allow",
        "cargo watch*": "allow",
        "cargo test*": "allow",
        "make test*": "allow",
        "git push*": "deny",
        "git reset*": "deny",
        "rm *": "deny",
        "sudo *": "deny",
        "terraform *": "deny",
        "kubectl delete*": "deny"
      },
      "task": "ask",
      "external_directory": "ask",
      "todowrite": "allow",
      "question": "allow",
      "webfetch": "allow",
      "websearch": "allow",
      "lsp": "allow",
      "skill": "allow",
      "doom_loop": "ask"
    },
    "agent": {
      "build": {
        "disable": true
      },
      "agent": {
        "mode": "primary",
        "description": "Agente principal para conversar, editar e executar ferramentas conforme permissoes.",
        "permission": {
          "question": "allow",
          "plan_enter": "allow"
        }
      },
      "compaction": {
        "model": "openai/gpt-5.4-mini"
      }
    }
  },
  "dcpConfig": {
    "$schema": "https://raw.githubusercontent.com/Opencode-DCP/opencode-dynamic-context-pruning/master/dcp.schema.json",
    "enabled": true,
    "debug": false,
    "pruneNotification": "minimal",
    "pruneNotificationType": "toast",
    "commands": {
      "enabled": true,
      "protectedTools": []
    },
    "manualMode": {
      "enabled": false,
      "automaticStrategies": true
    },
    "turnProtection": {
      "enabled": false,
      "turns": 4
    },
    "experimental": {
      "allowSubAgents": false,
      "customPrompts": false
    },
    "protectedFilePatterns": [],
    "compress": {
      "mode": "range",
      "permission": "allow",
      "showCompression": false,
      "summaryBuffer": true,
      "maxContextLimit": "80%",
      "minContextLimit": "45%",
      "nudgeFrequency": 5,
      "iterationNudgeThreshold": 15,
      "nudgeForce": "soft",
      "protectedTools": [],
      "protectUserMessages": false
    },
    "strategies": {
      "deduplication": {
        "enabled": true,
        "protectedTools": []
      },
      "purgeErrors": {
        "enabled": true,
        "turns": 4,
        "protectedTools": []
      }
    }
  },
  "fallbackConfig": {
    "$schema": "https://raw.githubusercontent.com/HyeokjaeLee/opencode-auto-fallback/main/docs/fallback.schema.json",
    "_generated": {
      "tool": "ogb",
      "version": "0.0.53",
      "warning": "Generated from the OGB UX profile. Project sync may refine it from local Gemini extension agents."
    },
    "enabled": false,
    "defaultFallback": [],
    "agentFallbacks": {
      "med-knowledge-architect": [
        {
          "model": "anthropic/claude-sonnet-4-6",
          "reasoningEffort": "high"
        },
        {
          "model": "openai/gpt-5.5",
          "reasoningEffort": "high",
          "variant": "high"
        }
      ],
      "med-flashcard-maker": [
        {
          "model": "anthropic/claude-sonnet-4-6",
          "reasoningEffort": "high"
        },
        {
          "model": "openai/gpt-5.5",
          "reasoningEffort": "high",
          "variant": "high"
        }
      ],
      "med-catalog-curator": [
        {
          "model": "openai/gpt-5.4",
          "reasoningEffort": "medium",
          "variant": "medium"
        },
        {
          "model": "anthropic/claude-sonnet-4-6",
          "reasoningEffort": "medium"
        }
      ],
      "med-chat-triager": [
        {
          "model": "openai/gpt-5.4-mini",
          "reasoningEffort": "medium",
          "variant": "medium"
        },
        {
          "model": "anthropic/claude-haiku-4-5",
          "reasoningEffort": "high"
        }
      ],
      "med-publish-guard": [
        {
          "model": "openai/gpt-5.4-mini",
          "reasoningEffort": "medium",
          "variant": "medium"
        },
        {
          "model": "anthropic/claude-haiku-4-5",
          "reasoningEffort": "high"
        }
      ]
    },
    "cooldownMs": 60000,
    "maxRetries": 2,
    "logging": false
  },
  "tuiConfig": {
    "mouse": true,
    "$schema": "https://opencode.ai/tui.json",
    "plugin": [
      "./tui-plugins/ogb-sidebar.js"
    ],
    "scroll_speed": 1
  },
  "projectConfig": {
    "openCode": {
      "defaultAgent": "YOLO"
    },
    "externalPlugins": {
      "quotaUi": {
        "enabled": false,
        "suppressOgbLimits": true,
        "enableToast": false,
        "formatStyle": "allWindows",
        "enabledProviders": [
          "openai",
          "anthropic",
          "google-gemini-cli"
        ],
        "onlyCurrentModel": false,
        "percentDisplayMode": "used"
      },
      "autoFallback": {
        "enabled": false,
        "plugin": "opencode-auto-fallback@0.4.3",
        "installProjectPlugin": false,
        "cooldownMs": 60000,
        "maxRetries": 2,
        "logging": false
      }
    },
    "modelFallbacks": {
      "agents": {
        "med-knowledge-architect": {
          "model": {
            "id": "google/gemini-3.1-pro-preview",
            "variant": "high"
          },
          "fallback_models": [
            {
              "model": "anthropic/claude-sonnet-4-6",
              "effort": "high"
            },
            {
              "model": "openai/gpt-5.5",
              "variant": "high"
            }
          ]
        },
        "med-flashcard-maker": {
          "model": {
            "id": "google/gemini-3.1-pro-preview",
            "variant": "high"
          },
          "fallback_models": [
            {
              "model": "anthropic/claude-sonnet-4-6",
              "effort": "high"
            },
            {
              "model": "openai/gpt-5.5",
              "variant": "high"
            }
          ]
        },
        "med-catalog-curator": {
          "model": {
            "id": "google/gemini-3.1-pro-preview",
            "variant": "medium"
          },
          "fallback_models": [
            {
              "model": "openai/gpt-5.4",
              "variant": "medium"
            },
            {
              "model": "anthropic/claude-sonnet-4-6",
              "effort": "medium"
            }
          ]
        },
        "med-chat-triager": {
          "model": {
            "id": "google/gemini-3-flash-preview",
            "variant": "high"
          },
          "fallback_models": [
            {
              "model": "openai/gpt-5.4-mini",
              "variant": "medium"
            },
            {
              "model": "anthropic/claude-haiku-4-5",
              "effort": "high"
            }
          ]
        },
        "med-publish-guard": {
          "model": {
            "id": "google/gemini-3-flash-preview",
            "variant": "high"
          },
          "fallback_models": [
            {
              "model": "openai/gpt-5.4-mini",
              "variant": "medium"
            },
            {
              "model": "anthropic/claude-haiku-4-5",
              "effort": "high"
            }
          ]
        }
      }
    }
  },
  "files": {
    "globalAgentsMd": "# OGB\n\nOGB is the OpenCode Gemini Bridge: the CLI that installs, syncs, checks and repairs Gemini CLI resources projected into OpenCode.\n\nPrefer `ogb install`, `ogb update`, `ogb check`, `ogb reset`. Use `ogb help` for discovery.\n\nInvariants: home is global, never a project; do not edit generated files by hand; do not run `ogb reset` unless explicitly asked.\n\n# Memory, Rules, and Skills\n\nScope\n- Use this `AGENTS.md` only for OpenCode-specific behavior, edit policy, and OGB rules.\n- Use canonical Gemini sources for durable memory and reusable rules/skills:\n  - Global: `~/.gemini/GEMINI.md` (Windows: `%USERPROFILE%\\.gemini\\GEMINI.md`).\n  - Project: `./GEMINI.md`.\n  - Skills: canonical Gemini/OGB skill source — never the generated OpenCode copy.\n\nEditing\n- When a canonical source imports more specific files, edit the most specific file, not the index.\n- Treat `.opencode/generated/*` and generated `.opencode/skills/*` as projection output. Never edit unless the user explicitly asks for an OpenCode-only change.\n- For \"remember this\" / durable preferences without scope, default to global Gemini memory.\n- Never store secrets, tokens, credentials, or private keys.\n\nSkills\n- Before creating a skill, check for an existing one with the same name or purpose.\n- Create reusable skills in the canonical Gemini/OGB layer. If creating an OpenCode-only skill in `.opencode/skills/<name>/SKILL.md`, warn the user it does not sync back to Gemini.\n\nSync & conflicts\n- After editing any canonical source, run or recommend `ogb sync`.\n- After larger changes or new skills, run or recommend `ogb doctor` or `ogb pass`.\n- On conflicts between `AGENTS.md`, global/project `GEMINI.md`, and skills: prefer the most specific canonical non-generated source. If unclear, stop and ask, or preview with `ogb bidirectional-sync --dry-run`.\n\n# Tool Preferences\n\n- Prefer the standard `bash` tool when PTY is denied or unstable.\n- When an interactive terminal command is blocked or denied inside OpenCode but the task clearly needs user interaction, open a macOS Terminal window for the user with the command prepared, and explain what they need to complete there.\n- `--tui` may not render through captured `bash` output; commands like `gemini-md-export` fall back to plain text automatically.\n\n# MCP Installation\n\nWhen the user asks to install an MCP server and the target is ambiguous, ask whether it is for Gemini CLI, OpenCode, or both before editing config.\n\n| Aspect       | Gemini CLI                          | OpenCode 1.14.x                          |\n| ------------ | ----------------------------------- | ---------------------------------------- |\n| Config file  | `~/.gemini/settings.json`           | `~/.config/opencode/opencode.json`       |\n| Top-level    | `mcpServers`                        | `mcp`                                    |\n| Server type  | (implicit)                          | `type: \"local\"`                          |\n| Command      | `command: \"npx\"` + `args: [...]`    | `command: [\"npx\", \"-y\", \"pkg@latest\"]`   |\n| Env vars     | `env`                               | `environment`                            |\n| Enabled flag | n/a                                 | `enabled: true`                          |\n\nRules\n- Never use the Gemini shape inside OpenCode config — OpenCode silently drops `command`/`args`/`env` and keeps only `enabled`.\n- Verify OpenCode installs with `opencode debug config` (resolved entry must keep `type`, `command`, `environment`) and `opencode mcp list` (server listed and connected).\n- Never store API keys directly in memory/rule files; use placeholders like `<API_KEY>`.\n",
    "startupPlugin": "",
    "tuiSidebarPlugin": "",
    "commands": {
      "research": "---\ndescription: Pesquisa web com citacoes e sintese curta\n---\n\nPesquise na web sobre:\n\n$ARGUMENTS\n\nUse pesquisa web quando precisar de informacao atual, verificacao externa ou\nfontes. Responda em portugues.\n\nContrato da resposta:\n\n- comece com uma resposta direta em 3-6 linhas;\n- destaque datas concretas quando o assunto for recente;\n- compare fontes se houver divergencia;\n- termine com uma secao `Fontes` com os links/citacoes retornados pela ferramenta;\n- se a busca nao for necessaria, diga isso brevemente e responda sem forcar web.\n",
      "upgrade-ogb": "---\ndescription: Atualiza o OpenCode Gemini Bridge pela release oficial\nsubtask: false\n---\n\nExecute exatamente:\n\nogb self-update --project \"$PWD\"\n\nDepois execute:\n\nogb doctor --project \"$PWD\"\n\nExplique em linguagem simples:\n- versao anterior e nova, se aparecerem na saida;\n- se o update reaplicou setup-ux/setup-opencode;\n- se o doctor ficou limpo;\n- se o OpenCode precisa ser reiniciado para carregar plugins, comandos ou agente default novos.\n"
    },
    "agents": {
      "YOLO": "---\ndescription: Direct execution with minimal friction in a trusted workspace.\nmode: primary\ncolor: \"#ffb4b4\"\npermission:\n  read: allow\n  edit: allow\n  glob: allow\n  grep: allow\n  list: allow\n  bash: allow\n  task: allow\n  external_directory: allow\n  question: allow\n  todowrite: allow\n  webfetch: allow\n  websearch: allow\n  lsp: allow\n  skill: allow\n  doom_loop: ask\n---\n\nYou are the YOLO mode of the OpenCode Gemini Bridge.\n\nUse this when the user selects this agent or when the project profile sets YOLO as the default.\n\nBehavior:\n- Execute directly when the request is clear.\n- Do not ask permission for normal read, build, test, local git, or edit commands when intent is clear.\n- Explain before destructive or irreversible actions, external publishing, or operations outside the workspace.\n- Prefer non-interactive commands.\n- When delegating generic engineering work, use the YOLO-worker subagent. Use specialized subagents only when the request needs their specific contract.\n- At the end, summarize all changes.\n",
      "YOLO-worker": "---\ndescription: Delegated low-friction execution for generic YOLO tasks.\nmode: subagent\ncolor: \"#ffd0a6\"\npermission:\n  read: allow\n  edit: allow\n  glob: allow\n  grep: allow\n  list: allow\n  bash: allow\n  task: allow\n  external_directory: allow\n  question: allow\n  todowrite: allow\n  webfetch: allow\n  websearch: allow\n  lsp: allow\n  skill: allow\n  doom_loop: ask\n---\n\nYou are the delegated worker for YOLO mode in the OpenCode Gemini Bridge.\n\nUse this subagent for generic engineering tasks when the primary YOLO agent wants to parallelize or isolate execution without losing YOLO behavior.\n\nBehavior:\n- Execute directly when the delegated scope is clear.\n- Do not ask permission for normal read, build, test, local git, or edit commands inside the workspace.\n- Explain before destructive or irreversible actions, external publishing, or operations outside the workspace.\n- Prefer non-interactive commands.\n- At the end, return a concise summary of changes, touched files, and verification.\n"
    },
    "skills": {
      "ogb-operator": {
        "SKILL.md": "---\nname: ogb-operator\ndescription: Use when helping an OGB user install, update, check, reset, or diagnose OpenCode Gemini Bridge without editing generated files by hand.\n---\n\n# OGB Operator\n\nOGB means OpenCode Gemini Bridge. It connects a user's Gemini CLI resources to OpenCode.\n\n## Mental Model\n\n- Gemini CLI is the source of context, settings, MCPs, commands, agents, skills and extensions.\n- OpenCode is where those resources are used.\n- OGB installs, syncs, checks and repairs the projection from Gemini into OpenCode.\n\n## Commands To Prefer\n\n| Need | Command | What it does |\n| --- | --- | --- |\n| Install or reinstall | `ogb install` | Sets up OGB and the OpenCode profile. |\n| Update | `ogb update` | Updates OGB and runs the post-update checks. |\n| Check everything | `ogb check` | Runs setup, sync, doctor, validation, security-check and dashboard. |\n| Reset | `ogb reset` | Rebuilds the global profile; only run when explicitly requested. |\n| Help | `ogb help` | Shows available commands. |\n\nOlder commands may still work, but prefer the new names:\n\n- `ogb pass` -> `ogb check`\n- `ogb self-update` / `ogb upgrade-ogb` -> `ogb update`\n\n## Rules\n\n- Home is global, never an OGB project.\n- Do not create `.opencode/generated` inside the user's home.\n- Do not edit generated OpenCode files by hand; rerun `ogb sync` or `ogb check`.\n- Do not run `ogb reset` unless the user explicitly asks.\n- After install, update or sync changes, run `ogb check`.\n- Treat extension hooks/scripts as review-only unless the user explicitly trusts them.\n\n## Basic Flow\n\nFor a normal health check:\n\n```sh\nogb --version\nogb check\n```\n\nIf something still looks wrong:\n\n```sh\nogb dashboard\nogb doctor\nogb validate\nogb security-check\n```\n\nUse `ogb sync` when the source resources changed and need to be projected again.\n\n## Install Or Update\n\nIf `ogb` already works:\n\n```sh\nogb update --release <tag>\nogb check\n```\n\nIf `ogb` is not recognized, use the official bootstrap command from the OGB release instructions, then run `ogb check`.\n\n## Reset\n\nReset is deliberate repair, not routine update.\n\n```sh\ncd ~\nogb reset --yes\nogb check\n```\n\nUse reset only from the user's home directory unless the user gives a specific project path.\n\n## Useful Paths\n\n```text\n~/.gemini/\n~/.config/opencode/\n~/.config/opencode-gemini-bridge/generated/\n```\n\nOn Windows, be careful with quoted paths and `.cmd` shims. If command execution looks broken, run `ogb check` and read `ogb dashboard` before changing files.\n"
      }
    }
  }
} satisfies UxProfilePreset;

export default UX_PROFILE_PRESET;
