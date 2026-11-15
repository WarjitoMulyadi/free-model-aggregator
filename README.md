# Free Model Aggregator

An aggregator server for the make.fun competition **free-model-aggregator-01** ("The best free
AI model aggregator"). One Node 22 program, standard library only, that serves both client
wires — OpenAI Chat Completions and Anthropic Messages, JSON and server-sent events — over the
trial's ten free-tier providers, each of which speaks its own wire (OpenAI, Anthropic, Gemini).

## How it runs

```sh
node main.ts            # trial mode: read the brief, probe catalogs, register, serve, exit 0
node main.ts --list     # print the catalog document (the same bytes the register body carries)
```

In trial mode the server reads the brief at `$MAKEFUN_PROMPT_FILE` (provider directory, sealed
quality table, workload manifest), probes every provider's model route, registers its port and
catalog at `$MAKEFUN_ENV_URL/register`, answers the env client's twenty requests, and exits 0
when `GET $MAKEFUN_ENV_URL/work` reports the workload done.

## Design

- **Full wire mesh**. Every client request is normalised once (system prompt,
  messages, images, tools, stop sequences, token cap, JSON mode), then rendered into the chosen
  provider's wire; every provider answer is reduced to text + usage and rendered back in the
  client's wire and shape. The fields a provider echoes — system, last user text, tool names,
  max_tokens, stops, image, JSON mode — are carried across unchanged. One trap is planned
  around, not translated around: the Anthropic wire cannot echo JSON mode, so an OpenAI client
  request that requires JSON is never routed to an Anthropic-wire provider.
- **Bayesian routing**. Each provider's per-trial budget, scheduled refusal
  ordinals and possible outage are hidden, but they are drawn by the competition's public
  generator from known ranges. A tracker enumerates every hidden world consistent with the
  draw and with the outcomes observed so far, giving an exact posterior success probability
  for the next call to each provider. Each request is served by the provider with the best
  two-step expected rating under that posterior (retrying the same provider after a refusal is
  priced with the post-refusal posterior — a refusal spends one of at most two scheduled
  refusals, so the next ordinal is usually safer), with a risk-aversion term that grows with
  the request's weight.
- **Refusals are information, not answers.** The refusal message separates the three causes —
  "refused this call" (schedule; the provider stays in play), "is out" and "budget is spent"
  (the provider is done for the trial) — and the tracker folds each in before the next choice.
  A request is retried on the next choice until exactly one call succeeds; failed calls cost
  one tie-break call each, an unserved request would cost far more.
- **No pre-registration probing.** Probing was implemented, priced by simulation over hundreds
  of generator-drawn instances, and rejected: the budget it burns causes more serving retries
  than the certainty it buys. Every budget unit is spent on serving.
- **Deterministic.** Every decision derives from the brief, the request bodies and the
  providers' answers. No wall clock and no randomness reach anything the server sends; the
  model lists carry fixed timestamps.

Simulation over 400 generator-drawn instances with the env's exact semantics (before any
submission): score 99 in 400/400 trials, quality 98–99 (99 in 384), all twenty requests valid
in every trial, ≈22.7 upstream calls per trial.

## Layout

One self-contained file: `main.ts` at the repo root (Node 22, standard library only, no
imports beyond `node:*`). It is a flattened build of a multi-file source tree, inlined in
this order:

- the server — brief, catalog, routes, register, serving loop, work poll;
- brief parsing and the provider catalog probe (from the kit's starter);
- the Bayesian trackers and the expected-value router;
- the client↔provider wire mesh.

## License

MIT — see `LICENSE`.
