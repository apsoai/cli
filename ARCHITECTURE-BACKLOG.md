# Architecture Backlog

Deepening opportunities identified during the CLI-first pivot (Phase 1). Each item reduces maintenance surface, improves testability, or eliminates dead code.

## 1. Collapse TypeScript Generation Dual-Path

**Priority:** High
**Files:** `src/commands/generate.ts`, `src/lib/generators/typescript.ts`, `src/lib/entity.ts`, `src/lib/dto.ts`, `src/lib/controller.ts`, `src/lib/service.ts`, `src/lib/module.ts`, `src/lib/enums.ts`, `src/lib/guards.ts`, `src/lib/index-module.ts`

TypeScript generation has two parallel implementations. The `generate` command branches at runtime: legacy standalone functions for TypeScript, `BaseGenerator` subclass system for Python/Go. The `TypeScriptGenerator` re-implements the same logic as the standalone functions with divergence risk.

**Fix:** Route all languages through the `LanguageGenerator` interface. Either wire standalone functions as the implementation behind `TypeScriptGenerator`, or move all logic into `TypeScriptGenerator` and delete the standalone files. The `generate` command loses its `if (typescript)` branch.

**Gains:** One code path to maintain and test. The `LanguageGenerator` interface becomes the single seam for all languages.

## 2. Absorb Shallow File-Per-Artifact Modules

**Priority:** Medium (downstream of #1)
**Files:** `src/lib/entity.ts`, `src/lib/dto.ts`, `src/lib/controller.ts`, `src/lib/service.ts`, `src/lib/module.ts`, `src/lib/enums.ts`, `src/lib/index-module.ts`, `src/lib/gql-dto.ts`

Each module exports one function with nearly identical signatures: assemble template data, call Eta, write file. The command orchestrates them manually. Adding a new artifact type means a new file, new export, and new orchestration call.

**Fix:** These become methods on (or are consumed by) the generator classes. The shared render+write pattern is already in `BaseGenerator`.

**Gains:** Adding a new artifact type means adding one method, not touching 3+ files. Downstream of #1.

## 3. Clean Up apsorc-parser Dead Code

**Priority:** Medium
**Files:** `src/lib/apsorc-parser.ts`

Three overlapping config loading strategies: `parseApsorc()` (used), `loadConfig()` (half-finished, returns `relationships: []` placeholder), `findConfigPath()` (only called by `loadConfig`). Two separate calls to `rc("apso")` create divergence risk.

**Fix:** Delete `loadConfig` and `findConfigPath`, or finish them and replace `parseApsorc`. One function, one return type.

**Gains:** One config loading path. No dead branches confusing future readers.

## 4. Delete Dead Template Copy Functions

**Priority:** Low
**Files:** `src/lib/utils/file-system.ts`

`createDirectoryContents` and `writeFile` are holdovers from an older template system. No command calls them. `init` uses git clone, `generate` uses Eta templates.

**Fix:** Delete both functions. Keep `createFile` and `withGeneratedMeta`.

**Gains:** Removes dead code that suggests an alternative template mechanism exists.

## 5. Fix Global Eta Singleton Configuration

**Priority:** Medium
**Files:** `src/commands/generate.ts`, `src/lib/generators/base.ts`, `src/lib/generators/typescript.ts`, `src/lib/generators/python.ts`

Every generator and command calls `Eta.configure()` with different `views` paths, mutating process-global state. Works only because commands run sequentially. The TypeScript legacy path configures Eta at import time, then `TypeScriptGenerator` re-configures it at construction.

**Fix:** Replace global Eta configuration with per-generator instances (Eta v3 supports this) or pass `views` at render time. `BaseGenerator.templateBasePath` already exists as the authority.

**Gains:** Eliminates hidden coupling. Each generator owns its template resolution without global side effects.

## 6. Add generateAll() to BaseGenerator

**Priority:** Low (downstream of #1)
**Files:** `src/commands/generate.ts`, `src/lib/generators/base.ts`

`scaffoldWithGenerator` manually loops through entities calling 6+ generator methods in sequence. The command has intimate knowledge of every artifact type and their ordering.

**Fix:** Add `generateAll(entities, options)` to `BaseGenerator`. The command calls one method. Individual generators can override ordering.

**Gains:** Command's interface to the generator shrinks to one call. Orchestration logic lives where language-specific ordering decisions belong.
