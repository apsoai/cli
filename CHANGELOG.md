# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- **Domain events (`emitEvents`) realigned to the Apso Distribution Model
  (apsoai/cli#91).** The CLI no longer generates the domain-event engine
  (`DomainEvent` entity, subscriber, mapper, relay, and `DomainEventsModule`)
  into `autogen/events/`. Instead, when at least one entity opts in via
  `emitEvents`, the generator emits a single schema-derived manifest at
  `autogen/events/event-emitting.entities.ts` that exports
  `EVENT_EMITTING_ENTITIES` (the opted-in entity classes) and
  `EVENT_EMITTING_ENTITY_NAMES`. The runtime engine now ships in the
  `@apso/domain-events` library (see apsoai/apso-packages#3) and is wired into
  the application by the `domain-events` skill.

### Migration
- Replace the previously generated engine under `autogen/events/` by installing
  `@apso/domain-events` and running the `domain-events` skill to wire the
  library's `DomainEventsModule`. The `.apsorc` `emitEvents` flag (per-entity or
  top-level default) is unchanged and now drives only the manifest.

## [0.8.3] - 2025-12-01

### Added
- TypeDoc generation support for API documentation
- Python/FastAPI service template support
- Go/Gin service template support

### Fixed
- Enum generation improvements for entity fields
- Template rendering edge cases

## [0.8.0] - 2025-06-01

### Added
- Multi-language support: TypeScript/NestJS, Python/FastAPI, Go/Gin
- BetterAuth integration for authentication scaffolding
- Data scoping and multi-tenancy support
- Input validation generation from schema constraints

## [0.7.0] - 2025-01-01

### Added
- GraphQL resolver generation
- Relationship scaffolding (OneToMany, ManyToOne, OneToOne, ManyToMany)
- Index generation from schema definitions
- Enum type support

## [0.6.0] - 2024-06-01

### Added
- Initial public release
- NestJS/TypeScript service scaffolding from `.apsorc` schema
- REST API endpoint generation
- TypeORM entity generation
- Database migration support
