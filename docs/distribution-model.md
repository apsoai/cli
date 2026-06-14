# Apso Distribution Model — Generate / Library / Skill

This governs a decision every CLI contributor faces: **should this new capability be code the CLI generates, or not?** Most of the time the answer is "not" — and this doc explains why and where it goes instead.

> Mirrored in the skills repo (`apsoai/skills` → `plugins/apso/references/architecture/distribution-model.md`). Keep the two in sync; this copy is framed for CLI contributors.

## The core idea

Sort code by **rate of change** and **source of truth**, then pick the distribution channel whose update mechanism matches. Three planes, plus the developer's own app:

| Plane | What lives here | Source of truth | How it updates | Consistency from |
|---|---|---|---|---|
| **Generated** (this CLI) | Schema-derived code: entities, DTOs, controllers, services, modules | `.apsorc` | `apso generate` (re-run) | Mechanical — same templates every time |
| **Library** (`apso-packages`) | Stable runtime/engine & architecture patterns: domain events, outbox + delivery, caching, idempotency… | A versioned package | `npm / pip / go get` update (semver) | The library is identical everywhere it's installed |
| **Skill** (`apsoai/skills`) | The recommended pattern + the wiring that composes generated code with a library | Skill definitions | Re-run / pull latest skill | The skill installs & wires a **pinned library**; never reimplements engine code |
| *(App)* | Which destination, secrets, cadence, business logic | The developer | Developer owns it | — |

## The decision rule

When adding a capability, ask in order:

1. **Does it change when the *schema* changes?** → **Generated.** It belongs in `autogen/`, regenerated on every schema change.
2. **Is it stable engine behavior Apso (or the community) improves over time, independent of any schema?** → **Library** (`apso-packages`). Ship a versioned package; the update path is a dependency bump.
3. **Is it a *decision* or *wiring* composing the other two?** → **Skill.** Installs the library + minimal wiring + captures choices. Must not hand-write engine code.
4. **Config/secrets/business logic?** → the **app's**. Document it (e.g. `.env.example`); don't generate or vendor it.

## `.apsorc` is the feature-control plane

`.apsorc` doesn't just describe the data model — it's where the developer **signals intent**, and that intent drives both codegen *and* which libraries/skills get wired in:

- `scopeBy` → signals tenant scoping; instructs what the generator adds.
- `emitEvents` → signals which entities to emit domain events for; pulls in the `@apso/domain-events` library + the `domain-events` skill.

For a **library feature**, the CLI's job is small and purely schema-derived: from the `.apsorc` signal it emits a **manifest** (e.g. the list of opted-in entity classes) that the library consumes — `DomainEventsModule.forRoot({ entities })`. The engine lives in the library, the wiring is the skill's, and the *on-switch* lives in `.apsorc`. So `.apsorc` flags are the feature toggles for capabilities, not the implementation of them.

## Why the CLI should generate *less*, not more

- **The service template (`service-template-ts`) is cloned once and never updated** — anything engine-y placed there is frozen forever.
- **Engine code generated into `autogen/` is workable but not ideal as the only channel:** regeneration is safe, but there's no natural trigger to regenerate for an engine fix that didn't touch the schema. A **library** makes `update` the trigger.
- **A skill alone drifts** (an agent re-wiring an engine each time differs subtly). The **library is the consistency anchor**; the skill is a thin installer on top. Consistency — Apso's edge — survives because the substance lives in the library.
- **We do not publish the whole codegen output as packages** (a 3-language version matrix = maintenance trap). Libraries are **per-feature and opt-in**, one language at a time.

## Implication for the CLI

The CLI's job is **schema-derived output**. Cross-cutting engine features (domain events, delivery, caching, idempotency, …) move to `apso-packages` libraries wired by skills — they are *not* new codegen.

Worked example — **domain events**: which entities emit is schema input; the `DomainEvent` model + transactional subscriber + relay + delivery adapters + poller live in `@apso/domain-events`; the `domain-events` skill installs and wires it; `EVENTS_DESTINATION`/secrets are the app's env. (This is why the CLI is being walked back *out* of generating that engine — see `apsoai/apso-packages`.)
