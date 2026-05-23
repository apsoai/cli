# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
