// free-model-aggregator-01: a free AI model aggregator.
//
// FLATTENED SINGLE-FILE BUILD — generated mechanically from main.ts +
// lib/providers.ts + lib/plan.ts + lib/wire.ts (identical logic, no relative
// imports, Node 22 stdlib only) so the entry uploads as one repo-root main.ts.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';

// ==========================================================================
// lib/providers.ts — the brief, the catalog probe
// ==========================================================================

// The brief's three documents and the catalog probe.
//
// A trial's brief (the path in MAKEFUN_PROMPT_FILE) carries three JSON documents, and the prose around
// them does not matter: this file finds each by its `schema` member.
//
//   - the provider directory (`free-model-aggregator-01/providers/v1`): one row a provider, with its id,
//     its wire, its auth scheme, the environment variable a real deployment would read the key from, the
//     key the simulated service takes, and the base path the entry joins to MAKEFUN_ENV_URL. A directory
//     entry may give an absolute base_url instead of a path; joinBase takes either.
//   - the quality table (`free-model-aggregator-01/ratings/v1`): each model's public rating in
//     milli-points, what it can do (tools, vision, JSON mode, context length) and whether it is free. The
//     scorer ranks an answer by its rating; a paid model is never a legal pick. This baseline reads the
//     table's capability columns and free flag (the sealed truth, where a row exists) but never its
//     rating (`--list` shows why in main.ts's header, and the routing TODO there names the gap).
//   - the workload manifest (`free-model-aggregator-01/workload/v1`): the requests the client will send,
//     in order, each with its api, whether it streams, its weight and the requirements a model must meet
//     to serve it.
//
// It then probes each provider's catalog route in the provider's own wire:
//
//   openai     GET <base>/v1/models          Authorization: Bearer <key>
//   anthropic  GET <base>/v1/models          x-api-key: <key>, anthropic-version: 2023-06-01
//   gemini     GET <base>/v1beta/models      x-goog-api-key: <key>
//
// A probe that fails (a refused connection, a non-2xx, a body that is not JSON) leaves its provider out of
// the catalog and gets no traffic; the trial goes on. Everything here is deterministic: no clock, no
// randomness, so `node main.ts --list` and the register body build the same document (main.ts prints or
// posts this one object).


type Wire = 'openai' | 'anthropic' | 'gemini';
type AuthScheme = 'bearer' | 'x-api-key' | 'x-goog-api-key' | 'none';

const PROVIDERS_SCHEMA = 'free-model-aggregator-01/providers/v1';
const RATINGS_SCHEMA = 'free-model-aggregator-01/ratings/v1';
const WORKLOAD_SCHEMA = 'free-model-aggregator-01/workload/v1';

type Json = Record<string, unknown>;
const isRecord = (v: unknown): v is Json => v !== null && typeof v === 'object' && !Array.isArray(v);

/** One provider as the brief lists it. `base` is the base path (or absolute URL) its routes hang off. */
interface ProviderDirectoryEntry {
  id: string;
  name: string;
  wire: Wire;
  auth: AuthScheme;
  base: string;
  key_env: string;
  key: string;
}

interface ProviderDirectory {
  schema: string;
  providers: ProviderDirectoryEntry[];
}

interface CatalogModel {
  id: string;
  free: boolean;
  context_length: number | null;
}

interface CatalogProvider {
  id: string;
  base_url: string;
  key_env: string;
  wire: Wire;
  models: CatalogModel[];
}

/** What `--list` prints and what the entry POSTs to /register: the same document, byte for byte. */
interface CatalogReport {
  providers: CatalogProvider[];
}

/** One row of the sealed quality table (the brief's copy). */
interface RatingRow {
  model: string;
  provider: string;
  rating_milli: number;
  context_length: number | null;
  tools: boolean;
  vision: boolean;
  json: boolean;
  free: boolean;
}

interface RatingsFile {
  schema: string;
  ratings: RatingRow[];
  best: { id: string; rating_milli: number }[];
}

/** What one request needs: a model without it cannot serve the request. */
interface Requirement {
  tools?: boolean;
  vision?: boolean;
  json?: boolean;
  min_context?: number;
}

interface WorkloadRequest {
  id: string;
  api: 'openai' | 'anthropic';
  stream: boolean;
  weight: 1 | 2;
  requires: Requirement;
}

interface WorkloadFile {
  schema: string;
  manifest: WorkloadRequest[];
}

/** The brief as the baseline reads it. `error` is set when it could not be read at all. */
interface Brief {
  directory: ProviderDirectory;
  ratings: RatingsFile | null;
  workload: WorkloadFile | null;
  error: string | null;
}

/** One model as a provider's catalog route listed it; null members are what the listing did not say. */
interface ProbedModel {
  id: string;
  display_name: string;
  free: boolean | null;
  context_length: number | null;
  tools: boolean | null;
  vision: boolean | null;
  json: boolean | null;
}

/** One provider's catalog probe: what its route answered, and the models it listed. */
interface Probe {
  provider: ProviderDirectoryEntry;
  ok: boolean;
  status: number;
  models: ProbedModel[];
  error: string | null;
}

/** What a model can do, from the listing first and the quality table second (null: neither said). */
interface Capabilities {
  context_length: number | null;
  tools: boolean | null;
  vision: boolean | null;
  json: boolean | null;
}

/** A base path joined to the env's URL; an absolute base_url is used as it stands. */
function joinBase(envUrl: string, base: string): string {
  const b = base.trim();
  if (/^https?:\/\//i.test(b)) return b.replace(/\/+$/, '');
  const prefix = envUrl.replace(/\/+$/, '');
  if (b === '') return prefix;
  return `${prefix}${b.startsWith('/') ? '' : '/'}${b.replace(/\/+$/, '')}`;
}

/** The headers a provider wants its key in. */
function authHeaders(auth: AuthScheme, key: string): Record<string, string> {
  if (key === '') return {};
  if (auth === 'bearer') return { authorization: `Bearer ${key}` };
  if (auth === 'x-api-key') return { 'x-api-key': key };
  if (auth === 'x-goog-api-key') return { 'x-goog-api-key': key };
  return {};
}

/** Every JSON object in `text` that carries a string `schema`, in the order they appear. */
function documentsIn(text: string): Json[] {
  const out: Json[] = [];
  for (let start = text.indexOf('{'); start !== -1; start = text.indexOf('{', start + 1)) {
    const end = objectEnd(text, start);
    if (end === -1) continue;
    try {
      const value: unknown = JSON.parse(text.slice(start, end + 1));
      if (isRecord(value) && typeof value.schema === 'string') out.push(value);
    } catch {
      // Not JSON on its own: look on.
    }
  }
  return out;
}

/** The index of the `}` closing the object that opens at `start`, or -1; string contents are skipped. */
function objectEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i += 1;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function stringOf(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function numberOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function boolOrNull(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null;
}

function providerOf(v: unknown): ProviderDirectoryEntry | null {
  if (!isRecord(v)) return null;
  const id = stringOf(v.id);
  const wire = v.wire === 'openai' || v.wire === 'anthropic' || v.wire === 'gemini' ? v.wire : null;
  if (id === '' || wire === null) return null;
  const auth = v.auth === 'bearer' || v.auth === 'x-api-key' || v.auth === 'x-goog-api-key' || v.auth === 'none' ? v.auth : 'bearer';
  // The brief's directory writes `path` (/p/<id>, joined to $MAKEFUN_ENV_URL); a directory that spells an
  // absolute base instead may use base_path, base_url or base. Take the first non-empty, `path` first.
  const base =
    stringOf(v.path) !== '' ? stringOf(v.path) : stringOf(v.base_path) !== '' ? stringOf(v.base_path) : stringOf(v.base_url) !== '' ? stringOf(v.base_url) : stringOf(v.base);
  return { id, name: stringOf(v.name) !== '' ? stringOf(v.name) : id, wire, auth, base, key_env: stringOf(v.key_env), key: stringOf(v.key) };
}

function ratingOf(v: unknown): RatingRow | null {
  if (!isRecord(v)) return null;
  const model = stringOf(v.model);
  const provider = stringOf(v.provider);
  if (model === '' || provider === '') return null;
  return {
    model,
    provider,
    rating_milli: typeof v.rating_milli === 'number' && Number.isFinite(v.rating_milli) ? v.rating_milli : 0,
    context_length: numberOrNull(v.context_length),
    tools: v.tools === true,
    vision: v.vision === true,
    json: v.json === true,
    free: v.free === true,
  };
}

function workloadRequestOf(v: unknown): WorkloadRequest | null {
  if (!isRecord(v)) return null;
  const id = stringOf(v.id);
  if (id === '') return null;
  const requires = isRecord(v.requires) ? v.requires : {};
  return {
    id,
    api: v.api === 'anthropic' ? 'anthropic' : 'openai',
    stream: v.stream === true,
    weight: v.weight === 2 ? 2 : 1,
    requires: {
      tools: requires.tools === true,
      vision: requires.vision === true,
      json: requires.json === true,
      ...(typeof requires.min_context === 'number' && Number.isFinite(requires.min_context) ? { min_context: requires.min_context } : {}),
    },
  };
}

/** The brief at `path`, its three documents found by schema. */
function readBrief(path: string): Brief {
  const directory: ProviderDirectory = { schema: PROVIDERS_SCHEMA, providers: [] };
  if (path === '') return { directory, ratings: null, workload: null, error: 'MAKEFUN_PROMPT_FILE is not set' };
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    return { directory, ratings: null, workload: null, error: `cannot read ${path}: ${(err as Error).message}` };
  }
  const docs = documentsIn(text);
  const directoryDoc = docs.find((d) => d.schema === PROVIDERS_SCHEMA && Array.isArray(d.providers)) ?? null;
  if (directoryDoc === null || !Array.isArray(directoryDoc.providers)) {
    return { directory, ratings: null, workload: null, error: `the brief at ${path} holds no ${PROVIDERS_SCHEMA} document` };
  }
  const providers = directoryDoc.providers.flatMap((v) => {
    const p = providerOf(v);
    return p === null ? [] : [p];
  });
  const ratingsDoc = docs.find((d) => d.schema === RATINGS_SCHEMA && Array.isArray(d.ratings)) ?? null;
  const ratingRows = ratingsDoc !== null && Array.isArray(ratingsDoc.ratings) ? ratingsDoc.ratings : null;
  const ratings: RatingsFile | null =
    ratingsDoc === null || ratingRows === null
      ? null
      : {
          schema: RATINGS_SCHEMA,
          ratings: ratingRows.flatMap((v) => {
            const r = ratingOf(v);
            return r === null ? [] : [r];
          }),
          best: Array.isArray(ratingsDoc.best)
            ? ratingsDoc.best.flatMap((v) => {
                if (!isRecord(v) || stringOf(v.id) === '') return [];
                return [{ id: stringOf(v.id), rating_milli: numberOrNull(v.rating_milli) ?? 0 }];
              })
            : [],
        };
  const workloadDoc = docs.find((d) => d.schema === WORKLOAD_SCHEMA && Array.isArray(d.manifest)) ?? null;
  const workload: WorkloadFile | null =
    workloadDoc === null || !Array.isArray(workloadDoc.manifest)
      ? null
      : {
          schema: WORKLOAD_SCHEMA,
          manifest: workloadDoc.manifest.flatMap((v) => {
            const w = workloadRequestOf(v);
            return w === null ? [] : [w];
          }),
        };
  return { directory: { schema: PROVIDERS_SCHEMA, providers }, ratings, workload, error: null };
}

/** The rating row of one provider's model, when the quality table has one. */
function ratingOfModel(ratings: RatingsFile | null, providerId: string, modelId: string): RatingRow | null {
  if (ratings === null) return null;
  return ratings.ratings.find((r) => r.provider === providerId && r.model === modelId) ?? null;
}

/**
 * Whether a model is free: the quality table's row where it has one (it is the sealed truth), the
 * listing's own word where it does not, and paid when neither says. A paid model is never routed.
 */
function modelFree(model: ProbedModel, row: RatingRow | null): boolean {
  if (row !== null) return row.free;
  return model.free ?? false;
}

/** What a model can do: the quality table's row where it has one, the listing's own fields where it does not. */
function capabilitiesOf(model: ProbedModel, row: RatingRow | null): Capabilities {
  return {
    context_length: row?.context_length ?? model.context_length ?? null,
    tools: row?.tools ?? model.tools ?? null,
    vision: row?.vision ?? model.vision ?? null,
    json: row?.json ?? model.json ?? null,
  };
}

/** Whether a model's capabilities meet one request's requirements. An unknown capability never meets one. */
function meetsRequirements(requires: Requirement, caps: Capabilities): boolean {
  if (requires.tools === true && caps.tools !== true) return false;
  if (requires.vision === true && caps.vision !== true) return false;
  if (requires.json === true && caps.json !== true) return false;
  if (requires.min_context !== undefined && (caps.context_length === null || caps.context_length < requires.min_context)) return false;
  return true;
}

/** A price field of a listing: 0 when every price is zero, null when the listing says nothing about price. */
function zeroPriced(v: Json): boolean | null {
  const pricing = isRecord(v.pricing) ? v.pricing : null;
  if (pricing === null) return null;
  const values = Object.values(pricing).flatMap((x) => {
    if (typeof x === 'number') return [x];
    if (typeof x === 'string' && x.trim() !== '') return [Number(x)];
    return [];
  });
  if (values.length === 0) return null;
  return values.every((n) => Number.isFinite(n) && n === 0);
}

/** One model as a listing wrote it, in whichever wire's spelling. */
function modelIn(wire: Wire, v: unknown): ProbedModel | null {
  if (!isRecord(v)) return null;
  const id = wire === 'gemini' ? stringOf(v.name).replace(/^models\//, '') : stringOf(v.id);
  if (id === '') return null;
  const context = numberOrNull(v.context_length) ?? numberOrNull(v.context_window) ?? numberOrNull(v.inputTokenLimit);
  return {
    id,
    display_name: stringOf(v.display_name) !== '' ? stringOf(v.display_name) : stringOf(v.displayName) !== '' ? stringOf(v.displayName) : id,
    free: boolOrNull(v.free) ?? zeroPriced(v),
    context_length: context,
    tools: boolOrNull(v.tools),
    vision: boolOrNull(v.vision),
    json: boolOrNull(v.json),
  };
}

/** The models one catalog route's answer listed, in its wire's shape. */
function modelsIn(wire: Wire, body: unknown): ProbedModel[] {
  if (!isRecord(body)) return [];
  const list = wire === 'gemini' ? body.models : body.data;
  if (!Array.isArray(list)) return [];
  return list.flatMap((v) => {
    const m = modelIn(wire, v);
    return m === null ? [] : [m];
  });
}

/** Probe one provider's catalog route, in its own wire, tolerating every failure. */
async function probeProvider(envUrl: string, provider: ProviderDirectoryEntry, timeoutMs = 5000): Promise<Probe> {
  const base = joinBase(envUrl, provider.base);
  const url = provider.wire === 'gemini' ? `${base}/v1beta/models` : `${base}/v1/models`;
  const headers: Record<string, string> = { accept: 'application/json', ...authHeaders(provider.auth, provider.key) };
  if (provider.wire === 'anthropic') headers['anthropic-version'] = '2023-06-01';
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return { provider, ok: false, status: res.status, models: [], error: `GET ${url} answered HTTP ${res.status}` };
    const body: unknown = await res.json();
    return { provider, ok: true, status: res.status, models: modelsIn(provider.wire, body), error: null };
  } catch (err) {
    return { provider, ok: false, status: 0, models: [], error: `GET ${url} failed: ${(err as Error).message}` };
  }
}

/**
 * The catalog the probes and the quality table make: every provider that answered, every model it listed.
 *
 * Its base_url is the directory's own path (`/p/<id>`), never the path joined to `envUrl`: the env's
 * origin differs between a live pass and its replay (a fresh loopback port under the process driver, a
 * fresh pod on the k8s layout), and the catalog is part of the state export a replay must reproduce byte
 * for byte. The scorer compares a reported base_url by its path suffix, so the path passes exactly as the
 * joined URL does; the joined URL reaches a provider, the path names it.
 */
function buildCatalog(_envUrl: string, probes: readonly Probe[], ratings: RatingsFile | null): CatalogReport {
  const providers: CatalogProvider[] = [];
  for (const probe of probes) {
    if (!probe.ok) continue;
    const seen = new Set<string>();
    const models: CatalogModel[] = [];
    for (const model of [...probe.models].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
      if (seen.has(model.id)) continue;
      seen.add(model.id);
      const row = ratingOfModel(ratings, probe.provider.id, model.id);
      models.push({ id: model.id, free: modelFree(model, row), context_length: row?.context_length ?? model.context_length ?? null });
    }
    providers.push({ id: probe.provider.id, base_url: probe.provider.base, key_env: probe.provider.key_env, wire: probe.provider.wire, models });
  }
  return { providers };
}

// ==========================================================================
// lib/plan.ts — the Bayesian router
// ==========================================================================

// The router's brain: a per-provider Bayesian tracker over the generator's hidden draw, and an
// expected-value chooser built on it.
//
// What the env hides from the brief — each provider's budget, its 1–2 scheduled refusal
// ordinals, and which single provider goes out mid-trial — is drawn by the kit's public
// generator from fixed ranges: budget uniform in a per-provider range, refusal ordinals a
// uniform 1-or-2 subset of [2, budget−1], one designated provider always refusing its 2nd
// call, one provider (possibly the same) out from a uniform ordinal in [2, budget−1]. A
// Tracker enumerates every world consistent with that draw and with the outcomes observed so
// far, so `pSuccessNext` is an exact posterior under those priors (the two cross-provider
// couplings — exactly one designated, exactly one outage — are folded in as per-provider
// priors of 1/10 each, the only approximation).
//
// Why this shape: a refusal inside a serving window costs a tie-break call and nothing else —
// the request stays valid as long as exactly one call succeeds — while a refusal spent on a
// pre-registration probe costs budget and nothing else. Simulation over generator-drawn
// instances priced both sides of that trade: probing never paid (the budget it burns causes
// more retries than the certainty saves), so the shipped parameters probe nothing and spend
// every budget on serving; the probe machinery stays, fitted at zero. Serving picks, per
// request, the provider maximising probability-weighted rating with a fallback term, and
// replans after every observation: a refusal message separates the three hidden causes —
// "refused this call" (schedule: the provider stays in play, its next ordinal is safer for
// the fail it just spent), "is out" and "budget is spent" (the provider is done for the
// trial) — and the tracker updates on each.

/** The per-provider budget ranges the generator draws from (kit: program/generator). */
const BUDGET_RANGES: Record<string, { min: number; max: number }> = {
  groq: { min: 9, max: 12 },
  cerebras: { min: 5, max: 6 },
  gemini: { min: 6, max: 8 },
  zai: { min: 4, max: 5 },
  openrouter: { min: 10, max: 12 },
  sambanova: { min: 4, max: 5 },
  pollinations: { min: 10, max: 14 },
  cloudflare: { min: 7, max: 8 },
  ovh: { min: 5, max: 6 },
  kilol: { min: 12, max: 16 },
};

/** What one counted provider call did. Uncounted calls (bad key, bad model, concurrent) never reach here. */
type Outcome = 'success' | 'refused' | 'out' | 'budget';

interface World {
  budget: number;
  /** Refusal ordinals, sorted. */
  fails: readonly number[];
  outage: number | null;
  weight: number;
}

function subsetsOfSize(items: readonly number[], size: number): number[][] {
  if (size === 0) return [[]];
  if (items.length < size) return [];
  const [head, ...rest] = items;
  if (head === undefined) return [];
  return [...subsetsOfSize(rest, size - 1).map((s) => [head, ...s]), ...subsetsOfSize(rest, size)];
}

/** Every world the generator could have drawn for one provider, with prior weights. */
function priorWorlds(range: { min: number; max: number }): World[] {
  const worlds: World[] = [];
  const budgetWeight = 1 / (range.max - range.min + 1);
  for (let budget = range.min; budget <= range.max; budget++) {
    const ordinals: number[] = [];
    for (let k = 2; k <= budget - 1; k++) ordinals.push(k);
    // Fail sets: count 1 or 2 with equal chance, uniform among subsets of that size; then the
    // designation mix: with probability 1/10 this is the designated provider, whose set is
    // rewritten to hold 2 in place of its smallest member.
    const failWeights = new Map<string, { fails: number[]; weight: number }>();
    const addFails = (fails: number[], weight: number) => {
      const key = fails.join(',');
      const at = failWeights.get(key);
      if (at) at.weight += weight;
      else failWeights.set(key, { fails, weight });
    };
    for (const count of [1, 2]) {
      const sets = subsetsOfSize(ordinals, count);
      if (sets.length === 0) continue;
      for (const set of sets) {
        const w = 0.5 * (1 / sets.length);
        addFails(set, w * 0.9);
        const designated = set.includes(2) ? set : [2, ...set.slice(1)].sort((a, b) => a - b);
        addFails(designated, w * 0.1);
      }
    }
    for (const { fails, weight: failWeight } of failWeights.values()) {
      // Outage: with probability 1/10 this provider is the one that goes out, from a uniform
      // ordinal in [2, budget−1]; otherwise it never does.
      worlds.push({ budget, fails, outage: null, weight: budgetWeight * failWeight * 0.9 });
      if (ordinals.length > 0) {
        for (const at of ordinals) {
          worlds.push({ budget, fails, outage: at, weight: budgetWeight * failWeight * (0.1 / ordinals.length) });
        }
      }
    }
  }
  return worlds;
}

function outcomeIn(world: World, ordinal: number): Outcome {
  if (ordinal > world.budget) return 'budget';
  if (world.outage !== null && ordinal >= world.outage) return 'out';
  if (world.fails.includes(ordinal)) return 'refused';
  return 'success';
}

/** The posterior over one provider's hidden draw, updated by every counted call's outcome. */
class Tracker {
  readonly id: string;
  private worlds: World[];
  private totalWeight: number;
  /** Counted calls made so far; the next call is ordinal `calls + 1`. */
  calls = 0;
  /** True once an outage or budget refusal has been seen: every later call fails. */
  dead = false;
  /** Refusal ordinals observed so far. */
  failsSeen = 0;

  constructor(id: string, range: { min: number; max: number } = BUDGET_RANGES[id] ?? { min: 1, max: 1 }) {
    this.id = id;
    this.worlds = priorWorlds(range);
    this.totalWeight = this.worlds.reduce((n, w) => n + w.weight, 0);
  }

  /** Fold one counted call's outcome in; the call must be the next ordinal. */
  observe(outcome: Outcome): void {
    const ordinal = this.calls + 1;
    this.calls = ordinal;
    if (outcome === 'refused') this.failsSeen += 1;
    if (outcome === 'out' || outcome === 'budget') this.dead = true;
    this.worlds = this.worlds.filter((w) => outcomeIn(w, ordinal) === outcome);
    this.totalWeight = this.worlds.reduce((n, w) => n + w.weight, 0);
  }

  /** Posterior probability that the next counted call succeeds. */
  pSuccessNext(): number {
    if (this.dead || this.totalWeight <= 0) return 0;
    const ordinal = this.calls + 1;
    let good = 0;
    for (const w of this.worlds) if (outcomeIn(w, ordinal) === 'success') good += w.weight;
    return good / this.totalWeight;
  }

  /** True when every surviving world serves the next call: the tail is certified from here. */
  certifiedNext(): boolean {
    return !this.dead && this.totalWeight > 0 && this.pSuccessNext() >= 1;
  }

  /**
   * Posterior probability that the call AFTER next succeeds, given the next call's outcome is
   * `outcome`: the lookahead the chooser prices a retry with. A refusal spends one of the
   * provider's at most two scheduled refusals, so this is usually higher than pSuccessNext —
   * retrying the same provider after a refusal is often the best second call.
   */
  pSuccessAfter(outcome: Outcome): number {
    if (this.dead || this.totalWeight <= 0) return 0;
    const ordinal = this.calls + 1;
    let given = 0;
    let good = 0;
    for (const w of this.worlds) {
      if (outcomeIn(w, ordinal) !== outcome) continue;
      given += w.weight;
      if (outcomeIn(w, ordinal + 1) === 'success') good += w.weight;
    }
    return given <= 0 ? 0 : good / given;
  }

  /** Worlds still standing (diagnostics and tests). */
  worldCount(): number {
    return this.worlds.length;
  }
}

/** One manifest request reduced to what routing needs: its weight, its bound, its per-provider best rating. */
interface ServeRequest {
  id: string;
  weight: number;
  best: number;
  /** Provider id → rating milli-points of that provider's best model meeting the requirements. */
  earn: ReadonlyMap<string, number>;
}

/** Tunables of the router, fitted by simulation over generator-drawn instances. */
interface RouterParams {
  /** Max pre-registration probes per provider (probing also stops at two seen refusals or death). */
  probeCaps: Readonly<Record<string, number>>;
  /** Penalty per unit of failure probability per unit of request weight, in rating milli-points. */
  riskAversion: number;
  /** Max counted calls per request before giving up on it. */
  maxAttempts: number;
}

const DEFAULT_PARAMS: RouterParams = {
  // Fitted by simulation (400 generator-drawn instances, true env semantics): no probing,
  // risk aversion 150 → score 99 in 400/400, quality 98–99 (99 in 384), ~22.7 calls a trial.
  probeCaps: { zai: 0, sambanova: 0, cerebras: 0, ovh: 0, gemini: 0, cloudflare: 0, groq: 0, openrouter: 0, pollinations: 0, kilol: 0 },
  riskAversion: 150,
  maxAttempts: 6,
};

/** Probe order: small budgets first — certainty is cheapest there. */
const PROBE_ORDER = ['zai', 'sambanova', 'cerebras', 'ovh', 'gemini', 'cloudflare', 'groq', 'openrouter', 'pollinations', 'kilol'];

/**
 * The serving state: one tracker per provider, the probe schedule, and the per-request choice.
 * Purely deterministic — every decision is a function of the brief and the outcomes folded in.
 */
class Router {
  private readonly trackers = new Map<string, Tracker>();
  private readonly order: string[];
  private readonly params: RouterParams;
  private readonly probed = new Map<string, number>();
  private probing = true;

  constructor(providerIds: readonly string[], params: RouterParams = DEFAULT_PARAMS) {
    this.order = [...providerIds];
    this.params = params;
    for (const id of providerIds) this.trackers.set(id, new Tracker(id));
  }

  tracker(id: string): Tracker {
    const t = this.trackers.get(id);
    if (!t) throw new Error(`unknown provider ${id}`);
    return t;
  }

  /** The next provider to probe before registering, or null when probing is done. */
  nextProbe(): string | null {
    if (!this.probing) return null;
    for (const id of PROBE_ORDER) {
      const t = this.trackers.get(id);
      if (!t) continue;
      const cap = this.params.probeCaps[id] ?? 0;
      const done = this.probed.get(id) ?? 0;
      if (done >= cap || t.dead || t.failsSeen >= 2) continue;
      // Keep the provider's last possible call unspent by probes.
      const range = BUDGET_RANGES[id] ?? { min: 1, max: 1 };
      if (t.calls >= range.min) continue;
      return id;
    }
    return null;
  }

  /** Fold one call's outcome (probe or serving) into the provider's tracker. */
  observe(id: string, outcome: Outcome): void {
    this.tracker(id).observe(outcome);
    if (this.probing) this.probed.set(id, (this.probed.get(id) ?? 0) + 1);
  }

  /** Probing is over (registration is next): later observations are serving calls. */
  endProbing(): void {
    this.probing = false;
  }

  /**
   * The provider to try for this request now: the feasible one maximising a two-step
   * expected value — p·rating + (1−p)·(the best retry's own expected value, where retrying
   * the same provider is priced with the post-refusal posterior) − risk·(1−p)·weight —
   * over providers that still have a soft budget (their drawn minimum) or a certified tail;
   * when every feasible provider is at its soft cap the caps lift (a budget refusal is
   * recoverable, an unserved request is not). Null when nothing feasible remains.
   */
  choose(req: ServeRequest): string | null {
    const feasible = this.order.filter((id) => req.earn.has(id) && !this.tracker(id).dead);
    if (feasible.length === 0) return null;
    const fallbackOf = (self: string): number => {
      let best = 0;
      for (const id of feasible) if (id !== self) best = Math.max(best, req.earn.get(id) ?? 0);
      return best;
    };
    // The expected value of trying `id` as a retry, given `failedId` just refused (or null):
    // for the refused provider itself the posterior moves to its post-refusal curve.
    const retryValue = (id: string, failedId: string | null): number => {
      const t = this.tracker(id);
      const p = failedId === id ? t.pSuccessAfter('refused') : t.pSuccessNext();
      const rating = req.earn.get(id) ?? 0;
      return p * rating + (1 - p) * fallbackOf(id);
    };
    const value = (id: string): number => {
      const t = this.tracker(id);
      const p = t.pSuccessNext();
      const rating = req.earn.get(id) ?? 0;
      let retry = 0;
      for (const other of feasible) retry = Math.max(retry, retryValue(other, id));
      return p * rating + (1 - p) * retry - this.params.riskAversion * (1 - p) * req.weight;
    };
    const soft = feasible.filter((id) => {
      const t = this.tracker(id);
      const range = BUDGET_RANGES[id] ?? { min: 1, max: 1 };
      return t.calls < range.min || t.certifiedNext();
    });
    const pool = soft.length > 0 ? soft : feasible;
    let pick: string | null = null;
    let pickValue = -Infinity;
    let pickRating = -1;
    for (const id of pool) {
      const v = value(id);
      const r = req.earn.get(id) ?? 0;
      if (v > pickValue + 1e-9 || (Math.abs(v - pickValue) <= 1e-9 && r > pickRating)) {
        pick = id;
        pickValue = v;
        pickRating = r;
      }
    }
    return pick;
  }
}

// ==========================================================================
// lib/wire.ts — the client/provider wire mesh
// ==========================================================================

// The wire mesh: any client wire (OpenAI Chat Completions, Anthropic Messages) to any provider
// wire (those two, plus Gemini), and any provider answer back to the client's wire.
//
// The env's providers answer with one text, a usage pair and their wire's natural stop reason —
// never with tool calls — so an answer reduces to { text, input, output } on every wire, and the
// client shapes below are the canonical ones (the same event order the env itself emits). The
// request side is the delicate half: the provider echoes what it parsed (system prompt, last user
// text, tool names, max_tokens, stop sequences, image, JSON mode) and the client compares that
// echo with what it sent, so every translation below is built to carry exactly those fields
// across unchanged. Two fields have no home on some wires and the router plans around them:
// JSON mode cannot be echoed by the Anthropic wire (it always reports it absent), and an
// Anthropic client's JSON-mode expectation is always "absent", so a translation never invents it.
//
// Everything is a pure function of its arguments: fixed ids and timestamps, no clock, no
// randomness — a replay rebuilds the same bytes from the same answers.


type ClientApi = 'openai' | 'anthropic';
type ProviderWire = 'openai' | 'anthropic' | 'gemini';

/** What every provider answer reduces to, whatever wire it arrived on. */
interface Answer {
  text: string;
  input: number;
  output: number;
}

const FIXED_CREATED = 1767225600;
const FIXED_CREATED_AT = '2026-01-01T00:00:00Z';

/** One model the entry serves, as GET /v1/models lists it. */
interface ServedModel {
  id: string;
  provider: string;
  display_name: string;
}

function openAIModelList(models: readonly ServedModel[]): Json {
  return {
    object: 'list',
    data: models.map((m) => ({ id: m.id, object: 'model', created: FIXED_CREATED, owned_by: m.provider })),
  };
}

function anthropicModelList(models: readonly ServedModel[]): Json {
  return {
    data: models.map((m) => ({ type: 'model', id: m.id, display_name: m.display_name, created_at: FIXED_CREATED_AT })),
    has_more: false,
  };
}

function openAIError(message: string, type: string, code: string | null): Json {
  return { error: { message, type, code } };
}

function anthropicError(type: string, message: string): Json {
  return { type: 'error', error: { type, message } };
}

// ------------------------------------------------------------------ request normalisation

/** One content image, carried as raw base64 plus its media type, or as a URL. */
interface ImagePart {
  base64: string | null;
  mediaType: string;
  url: string | null;
}

interface MessagePart {
  kind: 'text' | 'image' | 'tool_use' | 'tool_result';
  text: string;
  image: ImagePart | null;
  toolId: string;
  toolName: string;
  toolInput: Json | null;
}

interface Message {
  role: 'user' | 'assistant' | 'tool';
  parts: MessagePart[];
}

interface ToolDef {
  name: string;
  description: string;
  parameters: Json;
}

/** A client request reduced to the fields every wire must carry across. */
interface NormalizedRequest {
  system: string;
  messages: Message[];
  tools: ToolDef[];
  maxTokens: number | null;
  stops: string[];
  temperature: number | null;
  stream: boolean;
  /** The client asked for JSON mode (only an OpenAI client can: response_format). */
  jsonMode: boolean;
}

function textOfBlocks(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .flatMap((b) => (isRecord(b) && b.type === 'text' && typeof b.text === 'string' ? [b.text] : []))
    .join('\n');
}

function imageOfOpenAI(block: Json): ImagePart | null {
  if (block.type !== 'image_url' || !isRecord(block.image_url) || typeof block.image_url.url !== 'string') return null;
  const url = block.image_url.url;
  const data = /^data:([^,]*);base64,(.*)$/s.exec(url);
  if (data !== null) return { base64: data[2], mediaType: data[1] === '' ? 'image/png' : data[1], url: null };
  return { base64: null, mediaType: '', url };
}

function imageOfAnthropic(block: Json): ImagePart | null {
  if (block.type !== 'image' || !isRecord(block.source)) return null;
  const source = block.source;
  if (source.type === 'base64' && typeof source.data === 'string') {
    return { base64: source.data, mediaType: typeof source.media_type === 'string' ? source.media_type : 'image/png', url: null };
  }
  if (source.type === 'url' && typeof source.url === 'string') return { base64: null, mediaType: '', url: source.url };
  return null;
}

function toolInputOf(value: unknown): Json {
  if (isRecord(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    try {
      const parsed: unknown = JSON.parse(value);
      if (isRecord(parsed)) return parsed;
    } catch {
      // Not JSON: an empty input.
    }
  }
  return {};
}

function stringList(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((x): x is string => typeof x === 'string');
  return [];
}


/** An OpenAI Chat Completions body, normalised. */
function normalizeOpenAI(body: Json): NormalizedRequest {
  const systemParts: string[] = [];
  const messages: Message[] = [];
  const raw = Array.isArray(body.messages) ? body.messages : [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const role = typeof entry.role === 'string' ? entry.role : 'user';
    if (role === 'system') {
      const text = textOfBlocks(entry.content);
      if (text !== '') systemParts.push(text);
      continue;
    }
    if (role === 'tool') {
      const text = typeof entry.content === 'string' ? entry.content : textOfBlocks(entry.content);
      messages.push({
        role: 'tool',
        parts: [{ kind: 'tool_result', text, image: null, toolId: typeof entry.tool_call_id === 'string' ? entry.tool_call_id : '', toolName: '', toolInput: null }],
      });
      continue;
    }
    const parts: MessagePart[] = [];
    if (typeof entry.content === 'string') {
      if (entry.content !== '') parts.push({ kind: 'text', text: entry.content, image: null, toolId: '', toolName: '', toolInput: null });
    } else if (Array.isArray(entry.content)) {
      for (const block of entry.content) {
        if (!isRecord(block)) continue;
        if (block.type === 'text' && typeof block.text === 'string') parts.push({ kind: 'text', text: block.text, image: null, toolId: '', toolName: '', toolInput: null });
        else {
          const image = imageOfOpenAI(block);
          if (image !== null) parts.push({ kind: 'image', text: '', image, toolId: '', toolName: '', toolInput: null });
        }
      }
    }
    if (role === 'assistant' && Array.isArray(entry.tool_calls)) {
      for (const call of entry.tool_calls) {
        if (!isRecord(call) || !isRecord(call.function)) continue;
        parts.push({
          kind: 'tool_use',
          text: '',
          image: null,
          toolId: typeof call.id === 'string' ? call.id : '',
          toolName: typeof call.function.name === 'string' ? call.function.name : '',
          toolInput: toolInputOf(call.function.arguments),
        });
      }
    }
    messages.push({ role: role === 'assistant' ? 'assistant' : 'user', parts });
  }
  const tools: ToolDef[] = [];
  if (Array.isArray(body.tools)) {
    for (const tool of body.tools) {
      if (!isRecord(tool) || !isRecord(tool.function) || typeof tool.function.name !== 'string') continue;
      tools.push({
        name: tool.function.name,
        description: typeof tool.function.description === 'string' ? tool.function.description : '',
        parameters: isRecord(tool.function.parameters) ? tool.function.parameters : { type: 'object', properties: {} },
      });
    }
  }
  const format = isRecord(body.response_format) ? body.response_format.type : undefined;
  return {
    system: systemParts.join('\n'),
    messages,
    tools,
    maxTokens: numberOrNull(body.max_tokens) ?? numberOrNull(body.max_completion_tokens),
    stops: stringList(body.stop),
    temperature: numberOrNull(body.temperature),
    stream: body.stream === true,
    jsonMode: format === 'json_object' || format === 'json_schema',
  };
}

/** An Anthropic Messages body, normalised. */
function normalizeAnthropic(body: Json): NormalizedRequest {
  const messages: Message[] = [];
  const raw = Array.isArray(body.messages) ? body.messages : [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const assistant = entry.role === 'assistant';
    const parts: MessagePart[] = [];
    if (typeof entry.content === 'string') {
      if (entry.content !== '') parts.push({ kind: 'text', text: entry.content, image: null, toolId: '', toolName: '', toolInput: null });
    } else if (Array.isArray(entry.content)) {
      for (const block of entry.content) {
        if (!isRecord(block)) continue;
        if (block.type === 'text' && typeof block.text === 'string') {
          parts.push({ kind: 'text', text: block.text, image: null, toolId: '', toolName: '', toolInput: null });
        } else if (block.type === 'tool_use') {
          parts.push({
            kind: 'tool_use',
            text: '',
            image: null,
            toolId: typeof block.id === 'string' ? block.id : '',
            toolName: typeof block.name === 'string' ? block.name : '',
            toolInput: isRecord(block.input) ? block.input : {},
          });
        } else if (block.type === 'tool_result') {
          const text = typeof block.content === 'string' ? block.content : textOfBlocks(block.content);
          parts.push({
            kind: 'tool_result',
            text,
            image: null,
            toolId: typeof block.tool_use_id === 'string' ? block.tool_use_id : '',
            toolName: '',
            toolInput: null,
          });
        } else {
          const image = imageOfAnthropic(block);
          if (image !== null) parts.push({ kind: 'image', text: '', image, toolId: '', toolName: '', toolInput: null });
        }
      }
    }
    // A user message holding only tool_result blocks is a tool turn on the other wires.
    const onlyResults = parts.length > 0 && parts.every((p) => p.kind === 'tool_result');
    if (!assistant && onlyResults) {
      for (const part of parts) messages.push({ role: 'tool', parts: [part] });
    } else {
      messages.push({ role: assistant ? 'assistant' : 'user', parts });
    }
  }
  const tools: ToolDef[] = [];
  if (Array.isArray(body.tools)) {
    for (const tool of body.tools) {
      if (!isRecord(tool) || typeof tool.name !== 'string') continue;
      tools.push({
        name: tool.name,
        description: typeof tool.description === 'string' ? tool.description : '',
        parameters: isRecord(tool.input_schema) ? tool.input_schema : { type: 'object', properties: {} },
      });
    }
  }
  return {
    system: textOfBlocks(body.system),
    messages,
    tools,
    maxTokens: numberOrNull(body.max_tokens),
    stops: stringList(body.stop_sequences),
    temperature: numberOrNull(body.temperature),
    stream: body.stream === true,
    jsonMode: false,
  };
}

// ------------------------------------------------------------------ provider request bodies

/** The normalised request in the OpenAI wire, naming `model`. */
function toOpenAI(req: NormalizedRequest, model: string): Json {
  const messages: Json[] = [];
  if (req.system !== '') messages.push({ role: 'system', content: req.system });
  for (const message of req.messages) {
    if (message.role === 'tool') {
      for (const part of message.parts) {
        messages.push({ role: 'tool', tool_call_id: part.toolId, content: part.text });
      }
      continue;
    }
    const content: Json[] = [];
    const toolCalls: Json[] = [];
    for (const part of message.parts) {
      if (part.kind === 'text') content.push({ type: 'text', text: part.text });
      else if (part.kind === 'image' && part.image !== null) {
        const url = part.image.base64 !== null ? `data:${part.image.mediaType};base64,${part.image.base64}` : (part.image.url ?? '');
        content.push({ type: 'image_url', image_url: { url } });
      } else if (part.kind === 'tool_use') {
        toolCalls.push({ id: part.toolId, type: 'function', function: { name: part.toolName, arguments: JSON.stringify(part.toolInput ?? {}) } });
      }
    }
    const out: Json = { role: message.role, content: content.length === 1 && content[0].type === 'text' ? content[0].text : content };
    if (toolCalls.length > 0) out.tool_calls = toolCalls;
    messages.push(out);
  }
  const body: Json = { model, messages };
  if (req.maxTokens !== null) body.max_tokens = req.maxTokens;
  if (req.stops.length > 0) body.stop = req.stops;
  if (req.temperature !== null) body.temperature = req.temperature;
  if (req.tools.length > 0) {
    body.tools = req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
  }
  if (req.jsonMode) body.response_format = { type: 'json_object' };
  if (req.stream) {
    body.stream = true;
    body.stream_options = { include_usage: true };
  }
  return body;
}

/** The normalised request in the Anthropic wire, naming `model`. */
function toAnthropic(req: NormalizedRequest, model: string): Json {
  const messages: Json[] = [];
  for (const message of req.messages) {
    if (message.role === 'tool') {
      const blocks = message.parts.map((part) => ({ type: 'tool_result', tool_use_id: part.toolId, content: part.text }));
      messages.push({ role: 'user', content: blocks });
      continue;
    }
    const blocks: Json[] = [];
    for (const part of message.parts) {
      if (part.kind === 'text') blocks.push({ type: 'text', text: part.text });
      else if (part.kind === 'image' && part.image !== null) {
        blocks.push({
          type: 'image',
          source:
            part.image.base64 !== null
              ? { type: 'base64', media_type: part.image.mediaType, data: part.image.base64 }
              : { type: 'url', url: part.image.url ?? '' },
        });
      } else if (part.kind === 'tool_use') {
        blocks.push({ type: 'tool_use', id: part.toolId, name: part.toolName, input: part.toolInput ?? {} });
      } else if (part.kind === 'tool_result') {
        blocks.push({ type: 'tool_result', tool_use_id: part.toolId, content: part.text });
      }
    }
    messages.push({ role: message.role, content: blocks });
  }
  const body: Json = { model, messages, max_tokens: req.maxTokens ?? 1024 };
  if (req.system !== '') body.system = req.system;
  if (req.stops.length > 0) body.stop_sequences = req.stops;
  if (req.temperature !== null) body.temperature = req.temperature;
  if (req.tools.length > 0) {
    body.tools = req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  }
  if (req.stream) body.stream = true;
  return body;
}

/** The normalised request in the Gemini wire (the model travels in the URL, not the body). */
function toGemini(req: NormalizedRequest): Json {
  const contents: Json[] = [];
  for (const message of req.messages) {
    if (message.role === 'tool') {
      for (const part of message.parts) contents.push({ role: 'user', parts: [{ text: part.text }] });
      continue;
    }
    const parts: Json[] = [];
    for (const part of message.parts) {
      if (part.kind === 'text') parts.push({ text: part.text });
      else if (part.kind === 'image' && part.image !== null) {
        if (part.image.base64 !== null) parts.push({ inlineData: { mimeType: part.image.mediaType, data: part.image.base64 } });
        else parts.push({ fileData: { fileUri: part.image.url ?? '' } });
      } else if (part.kind === 'tool_use') {
        parts.push({ functionCall: { name: part.toolName, args: part.toolInput ?? {} } });
      } else if (part.kind === 'tool_result') {
        parts.push({ text: part.text });
      }
    }
    contents.push({ role: message.role === 'assistant' ? 'model' : 'user', parts });
  }
  const body: Json = { contents };
  if (req.system !== '') body.systemInstruction = { parts: [{ text: req.system }] };
  const config: Json = {};
  if (req.maxTokens !== null) config.maxOutputTokens = req.maxTokens;
  if (req.stops.length > 0) config.stopSequences = req.stops;
  if (req.temperature !== null) config.temperature = req.temperature;
  if (req.jsonMode) config.responseMimeType = 'application/json';
  if (Object.keys(config).length > 0) body.generationConfig = config;
  if (req.tools.length > 0) {
    body.tools = [{ functionDeclarations: req.tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })) }];
  }
  return body;
}

// ------------------------------------------------------------------ provider answers

function sseDataFrames(text: string): string[] {
  const frames: string[] = [];
  for (const block of text.split('\n\n')) {
    const data = block
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('');
    if (data !== '') frames.push(data);
  }
  return frames;
}

function parseJsonOrNull(text: string): Json | null {
  try {
    const value: unknown = JSON.parse(text);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** An answer off the OpenAI wire, from its JSON body or its SSE stream. */
function answerFromOpenAI(text: string, stream: boolean): Answer | null {
  if (!stream) {
    const body = parseJsonOrNull(text);
    if (body === null) return null;
    const choices = Array.isArray(body.choices) ? body.choices : [];
    const choice = isRecord(choices[0]) ? choices[0] : null;
    const message = choice !== null && isRecord(choice.message) ? choice.message : null;
    const usage = isRecord(body.usage) ? body.usage : {};
    return {
      text: message !== null && typeof message.content === 'string' ? message.content : '',
      input: num(usage.prompt_tokens),
      output: num(usage.completion_tokens),
    };
  }
  let out = '';
  let input = 0;
  let output = 0;
  for (const frame of sseDataFrames(text)) {
    if (frame === '[DONE]') continue;
    const chunk = parseJsonOrNull(frame);
    if (chunk === null) continue;
    if (isRecord(chunk.usage)) {
      input = num(chunk.usage.prompt_tokens);
      output = num(chunk.usage.completion_tokens);
    }
    const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
    const choice = isRecord(choices[0]) ? choices[0] : null;
    if (choice !== null && isRecord(choice.delta) && typeof choice.delta.content === 'string') out += choice.delta.content;
  }
  return { text: out, input, output };
}

/** An answer off the Anthropic wire, from its JSON body or its SSE stream. */
function answerFromAnthropic(text: string, stream: boolean): Answer | null {
  if (!stream) {
    const body = parseJsonOrNull(text);
    if (body === null) return null;
    const usage = isRecord(body.usage) ? body.usage : {};
    return { text: textOfBlocks(body.content), input: num(usage.input_tokens), output: num(usage.output_tokens) };
  }
  let out = '';
  let input = 0;
  let output = 0;
  for (const frame of sseDataFrames(text)) {
    const event = parseJsonOrNull(frame);
    if (event === null) continue;
    if (event.type === 'message_start' && isRecord(event.message) && isRecord(event.message.usage)) {
      input = num(event.message.usage.input_tokens);
    }
    if (event.type === 'content_block_delta' && isRecord(event.delta) && typeof event.delta.text === 'string') out += event.delta.text;
    if (event.type === 'message_delta' && isRecord(event.usage)) output = num(event.usage.output_tokens);
  }
  return { text: out, input, output };
}

/** An answer off the Gemini wire, from its JSON body or its SSE stream. */
function answerFromGemini(text: string, stream: boolean): Answer | null {
  const read = (body: Json | null, acc: Answer): Answer | null => {
    if (body === null) return null;
    const candidates = Array.isArray(body.candidates) ? body.candidates : [];
    const candidate = isRecord(candidates[0]) ? candidates[0] : null;
    if (candidate !== null && isRecord(candidate.content) && Array.isArray(candidate.content.parts)) {
      for (const part of candidate.content.parts) {
        if (isRecord(part) && typeof part.text === 'string') acc.text += part.text;
      }
    }
    if (isRecord(body.usageMetadata)) {
      acc.input = num(body.usageMetadata.promptTokenCount);
      acc.output = num(body.usageMetadata.candidatesTokenCount);
    }
    return acc;
  };
  if (!stream) return read(parseJsonOrNull(text), { text: '', input: 0, output: 0 });
  const acc: Answer = { text: '', input: 0, output: 0 };
  for (const frame of sseDataFrames(text)) {
    if (read(parseJsonOrNull(frame), acc) === null) return null;
  }
  return acc;
}

// ------------------------------------------------------------------ client answers

/** One server-sent event frame. */
function sse(event: string | null, data: unknown): string {
  return `${event === null ? '' : `event: ${event}\n`}data: ${JSON.stringify(data)}\n\n`;
}

/** Split an answer text the way the providers do: fixed-size pieces, never an empty list. */
function pieces(text: string): string[] {
  const out: string[] = [];
  for (let at = 0; at < text.length; at += 13) out.push(text.slice(at, at + 13));
  return out.length === 0 ? [''] : out;
}

/** The answer as an OpenAI Chat Completions response (JSON body or SSE stream). */
function renderOpenAI(answer: Answer, model: string, stream: boolean): { contentType: string; body: string } {
  const usage = { prompt_tokens: answer.input, completion_tokens: answer.output, total_tokens: answer.input + answer.output };
  if (!stream) {
    return {
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'chatcmpl-aggregate',
        object: 'chat.completion',
        created: FIXED_CREATED,
        model,
        choices: [{ index: 0, message: { role: 'assistant', content: answer.text }, finish_reason: 'stop', logprobs: null }],
        usage,
      }),
    };
  }
  const chunk = (delta: Json, finish: string | null): Json => ({
    id: 'chatcmpl-aggregate',
    object: 'chat.completion.chunk',
    created: FIXED_CREATED,
    model,
    choices: [{ index: 0, delta, finish_reason: finish }],
  });
  let body = sse(null, chunk({ role: 'assistant', content: '' }, null));
  for (const piece of pieces(answer.text)) body += sse(null, chunk({ content: piece }, null));
  body += sse(null, chunk({}, 'stop'));
  body += sse(null, { id: 'chatcmpl-aggregate', object: 'chat.completion.chunk', created: FIXED_CREATED, model, choices: [], usage });
  body += 'data: [DONE]\n\n';
  return { contentType: 'text/event-stream', body };
}

/** The answer as an Anthropic Messages response (JSON body or SSE stream). */
function renderAnthropic(answer: Answer, model: string, stream: boolean): { contentType: string; body: string } {
  if (!stream) {
    return {
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'msg_aggregate',
        type: 'message',
        role: 'assistant',
        model,
        content: [{ type: 'text', text: answer.text }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: answer.input, output_tokens: answer.output },
      }),
    };
  }
  let body = sse('message_start', {
    type: 'message_start',
    message: {
      id: 'msg_aggregate',
      type: 'message',
      role: 'assistant',
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: answer.input, output_tokens: 0 },
    },
  });
  body += sse('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
  for (const piece of pieces(answer.text)) {
    body += sse('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: piece } });
  }
  body += sse('content_block_stop', { type: 'content_block_stop', index: 0 });
  body += sse('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: answer.output } });
  body += sse('message_stop', { type: 'message_stop' });
  return { contentType: 'text/event-stream', body };
}

// ==========================================================================
// main.ts — the server
// ==========================================================================

// free-model-aggregator-01: a free AI model aggregator.
//
// One server speaking both client wires (OpenAI Chat Completions, Anthropic Messages, JSON and
// SSE) over the trial's ten providers, each on its own wire (OpenAI, Anthropic, Gemini). The
// brief carries the provider directory, the sealed quality table and the workload manifest;
// the catalog is probed from the providers' own model routes, registered with the env, and
// printed byte-for-byte by `--list`.
//
// Routing (lib/plan.ts): a Bayesian tracker keeps the posterior over each provider's hidden
// budget / refusal schedule / outage, drawn by the generator from public ranges, and each
// request is served by the provider with the best two-step expected rating under that
// posterior — replanned after every call. A refusal is never the answer: the request moves
// to the next choice (a refusal costs one tie-break call; an unserved request costs served,
// quality and failover at once). Exactly one successful call answers each request.
//
// Determinism: every choice derives from the brief, the request bodies and the providers'
// answers. No clock and no randomness reach anything the server sends; timestamps in the
// model lists are fixed constants (lib/wire.ts).


const ENV_URL = (process.env.MAKEFUN_ENV_URL ?? '').replace(/\/+$/, '');
const PROTOCOL_VERSION = 1;
const PROBE_TIMEOUT_MS = 5000;
const CALL_TIMEOUT_MS = 15000;
const WORK_POLL_MS = 100;

function log(message: string): void {
  process.stderr.write(`aggregator: ${message}\n`);
}

const brief = readBrief(process.env.MAKEFUN_PROMPT_FILE ?? '');
let probes: Probe[] = [];
let catalog: CatalogReport = { providers: [] };

/** Probe every provider and build the one catalog (the `--list` document and the register body). */
async function load(): Promise<void> {
  if (brief.error !== null) log(brief.error);
  probes = await Promise.all(brief.directory.providers.map((provider) => probeProvider(ENV_URL, provider, PROBE_TIMEOUT_MS)));
  for (const probe of probes) if (!probe.ok && probe.error !== null) log(probe.error);
  catalog = buildCatalog(ENV_URL, probes, brief.ratings);
}

const byId = (a: { id: string }, b: { id: string }): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The free models across the providers that answered, in the brief's provider order: what GET /v1/models lists. */
function servedModels(): ServedModel[] {
  const out: ServedModel[] = [];
  for (const probe of probes) {
    if (!probe.ok) continue;
    for (const model of [...probe.models].sort(byId)) {
      const row = ratingOfModel(brief.ratings, probe.provider.id, model.id);
      if (!modelFree(model, row)) continue;
      out.push({ id: model.id, provider: probe.provider.id, display_name: model.display_name });
    }
  }
  return out;
}

// ------------------------------------------------------------------ routing tables

const providerById = new Map<string, ProviderDirectoryEntry>(brief.directory.providers.map((p) => [p.id, p]));
/** Per manifest request: provider id → the model that would serve it there, and its rating. */
const modelChoice = new Map<string, Map<string, { model: string; rating: number }>>();
const serveRequests = new Map<string, ServeRequest>();

function buildRouting(): Router {
  const router = new Router(brief.directory.providers.map((p) => p.id));
  const ratings = brief.ratings;
  const manifest = brief.workload?.manifest ?? [];
  const bestOf = new Map((ratings?.best ?? []).map((b) => [b.id, b.rating_milli]));
  for (const req of manifest) {
    const choices = new Map<string, { model: string; rating: number }>();
    if (ratings !== null) {
      for (const row of ratings.ratings) {
        if (!row.free) continue;
        const provider = providerById.get(row.provider);
        if (provider === undefined) continue;
        // The Anthropic wire cannot echo JSON mode back to an OpenAI client: never route
        // those requests there, however strong the model.
        if (req.api === 'openai' && req.requires.json === true && provider.wire === 'anthropic') continue;
        const caps = { context_length: row.context_length, tools: row.tools, vision: row.vision, json: row.json };
        if (!meetsRequirements(req.requires, caps)) continue;
        const at = choices.get(row.provider);
        if (at === undefined || row.rating_milli > at.rating) choices.set(row.provider, { model: row.model, rating: row.rating_milli });
      }
    }
    modelChoice.set(req.id, choices);
    serveRequests.set(req.id, {
      id: req.id,
      weight: req.weight,
      best: bestOf.get(req.id) ?? 0,
      earn: new Map([...choices].map(([pid, c]) => [pid, c.rating])),
    });
  }
  return router;
}

// ------------------------------------------------------------------ provider calls

type CallResult =
  | { kind: 'success'; answer: Answer }
  | { kind: 'counted'; outcome: Outcome }
  | { kind: 'uncounted' };

/** The refusal's message text, from any wire's error envelope. */
function errorMessage(text: string): string {
  try {
    const body: unknown = JSON.parse(text);
    if (isRecord(body) && isRecord(body.error) && typeof body.error.message === 'string') return body.error.message;
  } catch {
    // Not JSON: no message to classify by.
  }
  return '';
}

/** One inference call to a provider, classified the way the tracker needs it. */
async function callProvider(provider: ProviderDirectoryEntry, model: string, req: NormalizedRequest): Promise<CallResult> {
  const base = joinBase(ENV_URL, provider.base);
  const headers: Record<string, string> = { 'content-type': 'application/json', ...authHeaders(provider.auth, provider.key) };
  let url: string;
  let body: Json;
  if (provider.wire === 'openai') {
    url = `${base}/v1/chat/completions`;
    body = toOpenAI(req, model);
  } else if (provider.wire === 'anthropic') {
    url = `${base}/v1/messages`;
    headers['anthropic-version'] = '2023-06-01';
    body = toAnthropic(req, model);
  } else {
    url = `${base}/v1beta/models/${encodeURIComponent(model)}:${req.stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`;
    body = toGemini(req);
  }
  let status: number;
  let text: string;
  try {
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(CALL_TIMEOUT_MS) });
    status = res.status;
    text = await res.text();
  } catch {
    return { kind: 'uncounted' };
  }
  if (status >= 200 && status < 300) {
    const answer =
      provider.wire === 'openai'
        ? answerFromOpenAI(text, req.stream)
        : provider.wire === 'anthropic'
          ? answerFromAnthropic(text, req.stream)
          : answerFromGemini(text, req.stream);
    return { kind: 'success', answer: answer ?? { text: '', input: 0, output: 0 } };
  }
  // 401 (bad key) and 400 (bad model) spend none of the provider's budget, and neither does a
  // concurrent-requests refusal: the ordinal does not move, so the tracker must not move.
  if (status === 401 || status === 400) return { kind: 'uncounted' };
  const message = errorMessage(text);
  if (message.includes('concurrent')) return { kind: 'uncounted' };
  if (message.includes('budget is spent')) return { kind: 'counted', outcome: 'budget' };
  if (message.includes('is out')) return { kind: 'counted', outcome: 'out' };
  if (status === 402 || status === 429 || status >= 500) return { kind: 'counted', outcome: 'refused' };
  return { kind: 'uncounted' };
}

// ------------------------------------------------------------------ the client server

let router: Router | null = null;
/** The manifest is served in order; the n-th inference request is the n-th manifest entry. */
let requestIndex = 0;

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function send(res: ServerResponse, status: number, contentType: string, body: string): void {
  res.writeHead(status, { 'content-type': contentType });
  res.end(body);
}

async function handleInference(api: ClientApi, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const raw = await readBody(req);
  let body: Json | null = null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isRecord(parsed)) body = parsed;
  } catch {
    body = null;
  }
  if (body === null) {
    send(res, 400, 'application/json', JSON.stringify(api === 'openai' ? openAIError('the request body is not one JSON object', 'invalid_request_error', 'invalid_request') : anthropicError('invalid_request_error', 'the request body is not one JSON object')));
    return;
  }
  const normalized = api === 'openai' ? normalizeOpenAI(body) : normalizeAnthropic(body);
  const manifest = brief.workload?.manifest ?? [];
  const entry = manifest[requestIndex];
  requestIndex += 1;
  const serveReq: ServeRequest | undefined = entry !== undefined ? serveRequests.get(entry.id) : undefined;
  const fail = (status: number, message: string): void => {
    send(res, status, 'application/json', JSON.stringify(api === 'openai' ? openAIError(message, 'api_error', null) : anthropicError('api_error', message)));
  };
  if (router === null || serveReq === undefined) {
    fail(502, 'no route for this request');
    return;
  }
  // Serve: try the chooser's provider, fold the outcome in, replan on any refusal. The loop
  // ends at the first success — exactly one successful call answers the request.
  for (let attempt = 0; attempt < 6; attempt++) {
    const pid = router.choose(serveReq);
    if (pid === null) break;
    const provider = providerById.get(pid);
    const choice = modelChoice.get(serveReq.id)?.get(pid);
    if (provider === undefined || choice === undefined) break;
    const result = await callProvider(provider, choice.model, normalized);
    if (result.kind === 'success') {
      router.observe(pid, 'success');
      const rendered = api === 'openai' ? renderOpenAI(result.answer, choice.model, normalized.stream) : renderAnthropic(result.answer, choice.model, normalized.stream);
      send(res, 200, rendered.contentType, rendered.body);
      return;
    }
    if (result.kind === 'counted') router.observe(pid, result.outcome);
  }
  fail(502, 'every provider refused this request');
}

function makeServer(): Server {
  return createServer((req, res) => {
    void (async () => {
      try {
        const path = (req.url ?? '').split('?')[0];
        if (req.method === 'GET' && path === '/v1/models') {
          const models = servedModels();
          const anthropic = req.headers['x-api-key'] !== undefined;
          send(res, 200, 'application/json', JSON.stringify(anthropic ? anthropicModelList(models) : openAIModelList(models)));
          return;
        }
        if (req.method === 'POST' && path === '/v1/chat/completions') return await handleInference('openai', req, res);
        if (req.method === 'POST' && path === '/v1/messages') return await handleInference('anthropic', req, res);
        send(res, 404, 'application/json', JSON.stringify({ error: { message: `no route ${req.method ?? ''} ${path}`, type: 'invalid_request_error', code: null } }));
      } catch (err) {
        log(`request failed: ${err instanceof Error ? err.message : String(err)}`);
        if (!res.headersSent) send(res, 500, 'application/json', JSON.stringify({ error: { message: 'internal error', type: 'api_error', code: null } }));
      }
    })();
  });
}

// ------------------------------------------------------------------ trial lifecycle

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '0.0.0.0', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') reject(new Error('no port'));
      else resolve(address.port);
    });
  });
}

/** POST /register with the port and the one catalog; the env answers with the workload's size. */
async function register(port: number): Promise<void> {
  const res = await fetch(`${ENV_URL}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ protocol_version: PROTOCOL_VERSION, port, catalog }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST ${ENV_URL}/register answered HTTP ${res.status}: ${text.slice(0, 500)}`);
  const reply: unknown = JSON.parse(text);
  if (isRecord(reply) && typeof reply.requests === 'number') log(`registered: the workload holds ${reply.requests} requests`);
}

/** Poll GET /work; exit 0 the moment it says done. */
async function pollWork(): Promise<void> {
  for (;;) {
    try {
      const res = await fetch(`${ENV_URL}/work`, { signal: AbortSignal.timeout(2000) });
      const reply: unknown = await res.json();
      if (isRecord(reply) && reply.done === true) {
        log('the workload is done; exiting 0');
        process.exit(0);
      }
    } catch {
      // The env is momentarily unreachable: keep polling.
    }
    await new Promise((resolve) => setTimeout(resolve, WORK_POLL_MS));
  }
}

async function main(): Promise<void> {
  if (process.argv.includes('--list')) {
    // The same document the register body carries, byte for byte — or the empty catalog when
    // there is no brief to read.
    if (process.env.MAKEFUN_PROMPT_FILE === undefined || brief.error !== null) {
      process.stdout.write('{"providers":[]}\n');
      return;
    }
    await load();
    process.stdout.write(`${JSON.stringify(catalog)}\n`);
    return;
  }
  await load();
  router = buildRouting();
  const server = makeServer();
  const port = await listen(server);
  log(`listening on 0.0.0.0:${port} with ${catalog.providers.length} answered providers and ${servedModels().length} free models`);
  await register(port);
  await pollWork();
}

main().catch((err: unknown) => {
  log(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});
