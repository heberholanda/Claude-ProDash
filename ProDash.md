# Especificação Técnica e Plano de Implementação: Claude CLI "Dashboard Pro" MOD

Este documento serve como o guia técnico definitivo para a construção, validação e testes do **MOD Dashboard Pro** para o Claude CLI (inspirado no layout Flightdeck, mas otimizado para densidade de informação limpa, hierarquia visual clara e controle integrado de agentes/forks).

---

## 1. Visão Geral e Objetivos do MOD

O **Dashboard Pro MOD** substitui a disposição atual de painéis fragmentados do Flightdeck por uma arquitetura modular baseada em blocos TUI (Terminal User Interface), dividida em quatro zonas principais:
1. **Header / System & Agent Overview Bar:** Consolidação de telemetria do sistema, consumo de tokens, estado de contexto e contadores de agentes (Running, Waiting, Idle, Total).
2. **Action Bar (Ações Rápidas):** Atalhos interativos para comandos globais (`Monitor All`, `Restart All`, `Agent Select`, `Gate Perms`, `Save Session Log`, `Project Board`).
3. **Split View Central (Session Console & Active Forks):** 
   - Lado esquerdo: Console unificado de logs de sessão com codificação de cores por nível (`INFO`, `SUCCESS`, `USER`, `WARN`, `ERROR`).
   - Lado direito: Lista de forks ativos com métricas de CPU em tempo real e tempo de execução (`RUNNING`, `WAITING`, `IDLE`).
4. **Command & Status Bar (Rodapé):** Prompt interativo padrão do Claude acompanhado de barra de status compacta (`auto mode on`, contagem de shells e monitores ativos).

---

## 2. Arquitetura de Componentes e Layout TUI

O layout deve ser renderizado utilizando bibliotecas de TUI em Node.js/Python (ex: `blessed`, `ink` ou renderização direta em buffer ANSI). A grade de colunas e linhas segue o modelo flexível abaixo:

```text
+-------------------------------------------------------------------------------------------------+
| SYSTEM STATUS              | AGENT OVERVIEW                     | SESSION METRICS               |
| CLAUDE DASHBOARD PRO       | AGENTS: [ ■■■■□□□□ ]               | SESSION DURATION: 02:18:30    |
| STATUS: ONLINE - NOMINAL   | [ RUNNING: 5 ] [ WAITING: 7 ] ...  | TOTAL TOKENS: 15.8M           |
| SYSTEM LOAD: [======] 38%  | CPU: [---/\---]  CTX: 14%          | EST. COST: +$8.79 ($1.07 turn)|
+----------------------------+------------------------------------+-------------------------------+
| [ MONITOR ALL ]  [ RESTART ALL ]  [ AGENT SELECT ]  [ GATE PERMS ]  [ SAVE LOG ]  [ PROJ BOARD ]|
+---------------------------------------------+---------------------------------------------------+
| SESSION CONSOLE                             | ACTIVE FORKS                                      |
| [13:04:31] [INFO] Ciclo de correções...     | ● 1: Distribuir jame... (RUNNING) CPU: 28%  9:29  |
| [13:04:34] [SUCCESS] Cachoeiras: Bash -> ls | ● 2: Peixes 3D com...   (RUNNING) CPU: 40% 22:46  |
| [13:05:16] [INFO] Cachoeiras: Write -> wf3  | 🟡 3: Pequenos cena...  (IDLE)             19:00  |
| [13:05:24] [INFO] Cachoeiras: Write -> patch| 🟡 4: Ciclo de cort...  (WAITING)          15:26  |
| [13:06:34] [USER] you: Aprovada inspirações | ● 5: Cachoeiras na...   (RUNNING) CPU: 35%  6:49  |
| [13:07:01] [INFO] Modelar pedra: spawned    | ○ 6: Executando te...   (IDLE)              0:27  |
+---------------------------------------------+---------------------------------------------------+
| > Cor da natureza: escolho a opção B                                                            |
+-------------------------------------------------------------------------------------------------+
| flightdeck: ctx 14% - agents 5/15                                                               |
| auto mode on | PR #56 | 4 shells, 1 monitor | ↓ to manage                                       |
+-------------------------------------------------------------------------------------------------+
```

---

## 3. Especificação Detalhada das Features

### 3.1. Header Consolidado (System & Agent Overview)
* **Bloco Esquerdo (`SYSTEM STATUS`):**
  - Exibe o status geral do daemon (`ONLINE`, `SYNCING`, `DEGRADED`).
  - Barra de progresso do `SYSTEM LOAD` calculada dinamicamente via chamadas nativas de CPU/RAM.
  - Alocação de memória RAM (`6.4GB / 16GB`).
* **Bloco Central (`AGENT OVERVIEW`):**
  - Histograma miniatura de distribuição de agentes.
  - Contadores absolutos: `RUNNING`, `WAITING`, `IDLE`, `TOTAL`.
  - Gráfico centelha (sparkline) de uso de CPU e Limite de Contexto (`CTX LIMIT: 14%`).
* **Bloco Direito (`SESSION METRICS`):**
  - Duração acumulada da sessão.
  - Consumo total de tokens processados.
  - Custo acumulado estimado e custo do último *turn*.
  - Atalho rápido para `[REVIEW AUDIT LOGS]`.

### 3.2. Action Bar Dinâmica
Botões de clique rápido ou seleção via teclado (`Tab` / setas):
* `[ MONITOR ALL ]`: Alterna o modo de visualização multi-stream de todos os agentes ativos.
* `[ RESTART ALL ]`: Executa reinicialização segura de forks travados com confirmação de segurança.
* `[ AGENT SELECT ]`: Abre modal interativo de gerenciamento de sub-agentes individuais.
* `[ GATE PERMS ]`: Exibe painel de controle de permissões de arquivos/shell (substituindo o grid confuso original).
* `[ SAVE SESSION LOG ]`: Salva instantaneamente o buffer do console em um arquivo `.log` com carimbo de data/hora.
* `[ PROJECT BOARD ]`: Exibe o quadro Kanban ou o progresso de tarefas ativas do projeto.

### 3.3. Split View Central (Console + Forks)
* **Console de Sessão:**
  - Formatação com marcação de cores ANSI estrito: timestamps em cinza escuro, tags `[INFO]` (azul), `[SUCCESS]` (verde), `[USER]` (amarelo claro), `[WARN]` (laranja), `[ERROR]` (vermelho).
  - Rolagem automática inteligente (pausa caso o usuário suba o cursor para leitura manual).
* **Forks Ativos:**
  - Indicadores visuais de estado (● Verde para `RUNNING`, 🟡 Amarelo para `WAITING/IDLE`, ○ Cinza para `STOPPED`).
  - Nome do fork truncado responsivamente, estado atual, consumo percentual de CPU por fork e tempo decorrido.

---

## 4. Plano de Validação e Testes

Para garantir que o MOD funcione perfeitamente sem corromper o comportamento nativo do Claude CLI, siga rigorosamente o plano de testes abaixo:

### FASE 1: Testes Unitários de Renderização TUI
1. **Teste de Redimensionamento de Janela:**
   - Reduzir o terminal para colunas menores ($< 100$ colunas) e verificar se o painel se comprime sem quebrar o layout (truncamento elegante de strings).
2. **Teste de Carga de CPU/Memória:**
   - Inserir mocks de uso de CPU a 100% e validar se a barra de progresso e as cores de alerta mudam corretamente.

### FASE 2: Testes de Integração com o Core do Claude
1. **Validação de Sockets / Forks:**
   - Iniciar múltiplos sub-agentes (ex: 8 simultâneos) e verificar se o contador no `AGENT OVERVIEW` e a lista em `ACTIVE FORKS` atualizam em tempo real (latência $< 200ms$).
2. **Registro de Logs no Console:**
   - Disparar ações de gravação de arquivos e chamadas de Bash via Claude para garantir que o fluxo de eventos seja capturado e exibido no `SESSION CONSOLE` na ordem cronológica exata.

### FASE 3: Testes de Usabilidade e Acessibilidade (User Acceptance)
1. **Navegação por Teclado:**
   - Garantir que todas as opções da `ACTION BAR` possam ser acessadas via atalhos de teclado configuráveis (ex: `Ctrl + 1` até `Ctrl + 6`).
2. **Estabilidade de Memória:**
   - Manter a sessão rodando por mais de 2 horas simuladas para checar se há vazamento de memória (*memory leak*) no buffer de logs do console.

---

## 5. Instruções para o Claude Desenvolvedor (Próximos Passos)

1. Utilize este documento como o escopo base.
2. Crie o arquivo principal do plugin do MOD (ex: `dashboard_mod.js` ou equivalente na estrutura do Claude CLI).
3. Implemente primeiro o layout estrutural superior e valide a renderização.
4. Conecte os seletores de estado dos sub-agentes aos eventos reais do motor do Claude.
5. Execute a bateria de testes descrita na Seção 4.