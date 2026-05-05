---
description: Painel principal do OpenCode Gemini Bridge
subtask: false
---

Primeiro rode pwd para confirmar o diretorio atual.

Depois execute exatamente:

ogb bridge --project "$PWD"

Use a saida desse comando como fonte principal. Se precisar ler o arquivo, leia apenas este caminho exato dentro do diretorio atual:

.opencode/generated/ogb-dashboard.md

Nao use glob, find ou busca recursiva na home do usuario. Se o painel mostrar que o projeto atual e a home e o usuario esperava outro projeto, explique que o OpenCode foi aberto na home e que ele deve abrir o OpenCode no diretorio do projeto ou rodar ogb bridge --project /caminho/do/projeto.

Explique em linguagem simples:
- se o bridge esta PASS, WARN ou FAIL;
- ultimo startup sync;
- MCPs, skills, agente YOLO e comandos carregados;
- extensoes Gemini projetadas;
- proximo passo concreto.

Nao edite arquivos.
