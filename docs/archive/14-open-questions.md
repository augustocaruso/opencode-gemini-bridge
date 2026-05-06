# Open questions

## 1. Sidebar customizada

O OpenCode permite plugin e eventos, mas é necessário verificar até onde a UI/sidebar pode ser customizada hoje.

Fallback: commands `/doctor`, `/status`, `/resources`.

## 2. Gemini Extensions schema exato

Precisamos capturar o manifest exato das extensões Gemini usadas pelo usuário e validar todos os campos.

## 3. Hooks

Quais hooks Gemini são essenciais para estudo/automação? Quais são perigosos? Quais podem virar scripts e quais precisam plugin?

## 4. Auth Gemini

O usuário aceitará risco do `opencode-gemini-auth`, ou prefere Gemini API key/Vertex?

## 5. OpenAI provider

OpenAI será usado via assinatura ChatGPT/Plus/Pro no OpenCode ou API key? Isso afeta quota e billing.

## 6. Distribuição

O projeto será privado, compartilhado com amigo, ou open source?

## 7. Windows

O PC Windows do amigo terá:

- Node?
- Git?
- PowerShell 7?
- WSL?
- Permissão para symlink?

## 8. Escopo de automação

Quais automações são esperadas?

- Arquivos locais?
- Browser?
- Obsidian/Anki?
- Notion?
- Email/calendário?
- Estudos médicos?

Isso muda quais MCPs e skills devem ser prioridade.
