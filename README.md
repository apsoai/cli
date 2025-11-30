# Apso CLI

Generate production-ready NestJS backends from schema definitions.

## Quick Start

```bash
# 1. Install CLI
npm install -g @apso/apso-cli

# 2. Create new project
apso server new --name myapp

# 3. Edit .apsorc to define your schema (see examples below)

# 4. Generate code
apso server scaffold

# 5. Start database & provision schema
npm run compose && npm run provision

# 6. Run development server
npm run start:dev
```

---

## Table of Contents

- [Quick Start](#quick-start)
- [Usage](#usage)
- [Important: Never Modify Autogen Files](#-important-never-add-custom-code-to-autogen-files)
- [Common First-Time Mistakes](#️-common-first-time-mistakes)
- [Local Development](#local-development)
- [Populating an .apsorc File](#populating-an-apsorc-file)
- [Auto-Generated Code Reference](#auto-generated-code-reference)
- [Relationships](#relationships)
- [Authentication (Bring Your Own Auth)](#authentication-bring-your-own-auth)
- [Data Scoping (Multi-Tenant Isolation)](#data-scoping-multi-tenant-isolation)
- [Authentication + Scoping: Working Together](#authentication--scoping-working-together)
- [Schema Reference](#schema-reference)
- [Debugging](#debugging)
- [Commands](#commands)

---

# Usage

Follow these steps to create and run a new APSO server project:

1. **Install the CLI globally:**
   ```sh
   npm install -g @apso/apso-cli
   ```

2. **Initialize a new server project:**
   ```sh
   apso server new --name <PROJECT_NAME>
   ```
   This creates a new project folder with the necessary boilerplate.

3. **Define your database schema:**
   Edit the `.apsorc` file in your new project folder to describe your entities and relationships. See the [Populating an .apsorc File](#populating-an-apsorc-file) section for details and examples.

4. **Generate code and database entities:**
   ```sh
   apso server scaffold
   ```
   This command generates all relevant modules and entity code based on your `.apsorc` file.

5. **Configure your database connection:**
   Update your project's `.env` file with the database credentials you want to use.

6. **Start the local Postgres instance (Docker):**
   ```sh
   npm run compose
   ```
   This command uses Docker Compose to start a local Postgres database instance.

7. **Provision your schema/database:**
   ```sh
   npm run provision
   ```
   This sets up your new schema instance in the database.

8. **(Optional) Enable automatic model sync for local development:**
   If you want to skip manual migrations and always sync your models with the database (useful for rapid prototyping or starting from scratch), set the following in your `.env` file:
   ```env
   DATABASE_SYNC=true
   ```
   With this setting, your models will be automatically synced to the database on startup.

> For more details on configuring your schema, see the [Populating an .apsorc File](#populating-an-apsorc-file) section below.

---

## 📢 Important: Never Add Custom Code to Autogen Files

Apso CLI generates all files in the `autogen/` directory automatically.  
**Any changes you make directly to these files will be overwritten the next time you run Apso CLI.**  
To keep your custom logic safe and maintainable, always use the `extensions/` directory for any customizations.

### How to Extend Apso-Generated Entities

#### 1. **Never modify files in `autogen/`**

- All files in `src/autogen/` are managed by Apso CLI.
- These include entities, services, controllers, DTOs, and modules.
- **Do not add custom endpoints, business logic, or integrations here.**

#### 2. **Add custom logic in `extensions/`**

- For each entity you want to extend, create a corresponding folder in `src/extensions/[[EntityName]]/`.
- Add your custom service, controller, and DTOs here.
- You can inject and extend the autogen service in your extension service.

#### 3. **Example Directory Structure**

```
src/
  autogen/
    LambdaDeployment/
      LambdaDeployment.service.ts   # DO NOT MODIFY
      LambdaDeployment.controller.ts
      ...
  extensions/
    LambdaDeployment/
      LambdaDeployment.service.ts   # Add custom logic here
      LambdaDeployment.controller.ts
      ...
```

#### 4. **Example: Extending LambdaDeployment**

**Custom Service:**
```typescript
// src/extensions/LambdaDeployment/LambdaDeployment.service.ts
import { Injectable } from '@nestjs/common';
import { LambdaDeploymentService as AutogenLambdaDeploymentService } from '../../autogen/LambdaDeployment/LambdaDeployment.service';

@Injectable()
export class LambdaDeploymentService extends AutogenLambdaDeploymentService {
  // Add your custom methods here
  async deployWithLocalService(...) { ... }
}
```

**Custom Controller:**
```typescript
// src/extensions/LambdaDeployment/LambdaDeployment.controller.ts
import { Controller } from '@nestjs/common';
import { LambdaDeploymentService } from './LambdaDeployment.service';

@Controller('lambda-deployment')
export class LambdaDeploymentController {
  constructor(private readonly lambdaDeploymentService: LambdaDeploymentService) {}

  // Add custom endpoints here
}
```

#### 5. **Why This Matters**

- Keeps your custom business logic safe from being overwritten.
- Makes it easy to regenerate your API as your data model evolves.
- Maintains a clean separation between generated code and your application logic.

#### 6. **Best Practices**

- Only use the autogen files for base CRUD and entity logic.
- Place all custom endpoints, integrations, and business logic in the `extensions/` directory.
- If you need to override or extend a method, subclass the autogen service in your extension service.

---

**Summary:**
> Always put your custom code in `src/extensions/[[EntityName]]/`.
> Never modify files in `src/autogen/`.
> This ensures your work is safe and your project remains maintainable as you evolve your data model with Apso CLI.

---

## ⚠️ Common First-Time Mistakes

### 1. Modifying `autogen/` Files
**Problem:** Changes get overwritten on next scaffold
**Solution:** Always use `extensions/` directory for custom code

### 2. Defining Both Sides of Relationships
**Problem:** Duplicate properties and TypeScript errors
**Solution:** Define relationships **once** - Apso auto-generates the inverse side

Example:
```json
// ❌ WRONG - Creates conflicts
{ "from": "User", "to": "Workspace", "type": "OneToMany" }
{ "from": "Workspace", "to": "User", "type": "ManyToOne" }

// ✅ CORRECT - Define one side only
{ "from": "Workspace", "to": "User", "type": "ManyToOne", "to_name": "owner" }
```

### 3. Skipping Database Provisioning
**Problem:** Server fails to start with missing table errors
**Solution:** Always run `npm run provision` after scaffold

### 4. Wrong .apsorc Version
**Problem:** Schema doesn't generate correctly
**Solution:** Ensure `"version": 2` at top of .apsorc

### 5. Forgetting to Start Docker
**Problem:** Database connection refused errors
**Solution:** Run `npm run compose` before starting server

---

# Local Development

Clone apso-cli on your machine. Navigate to the repo in your code editor and run the below commands

```sh-session
npm install
npm run build && npm link
```

This will build the apso cli and make it available for use globally on your machine. Now make a new directory where you want to setup a new backend service. Run the below command in order to create a new service boilerplate. This will clone the apso-service-template from github.

Incase you face permission denied issue make sure that you have SSH key added in github and your local machine. Follow this [link](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/generating-a-new-ssh-key-and-adding-it-to-the-ssh-agent) for SSH keys generation.

```sh-session
apso server new -n <project-name>
```

Then navigate to the newly created service and update the apsorc file according to your project entities and relations.

Sample of apsorc files for both v1 and v2 are given in apso-cli code at "test/apsorc-json" so you can check it out in order to make sure that your apsorc file follows the right pattern.

For detailed examples of configuring complex relationships, especially ManyToMany and self-referencing patterns, see the [Relationship Configuration Use Cases](./UseCases.md).

You can also provide the key "apiType" in the apsorc file e.g (Rest, Graphql) incase you want to generate the GraphQL backend by default it would be REST.

Install the npm modules before continuing further.

Now we will run the scaffold command which will generate the all the relevant modules for us.

```sh-session
apso server scaffold
```

# Populating an .apsorc File

The `.apsorc` file defines your domain model, including entities and their relationships, for APSO code generation. It is required for scaffolding your backend service.

## How to Create and Populate `.apsorc`

1. **Location**: Place the `.apsorc` file in the root of your service directory.
2. **Version**: Set the `version` property to `2` for the latest schema.
3. **Entities**: Define each domain entity, its fields, and any unique constraints.
4. **Relationships**: Specify how entities relate (e.g., OneToMany, ManyToOne, etc.).
5. **rootFolder**: Set the folder where generated code will be placed (e.g., `src`).

> **Tip:** You can find sample `.apsorc` files in `apso-cli/test/apsorc-json/` for both v1 and v2 formats.

### Example `.apsorc` v2 File

```json
{
  "version": 2,
  "rootFolder": "src",
  "relationships": [
    { "from": "User", "to": "WorkspaceUser", "type": "OneToMany", "nullable": true },
    { "from": "Workspace", "to": "WorkspaceUser", "type": "OneToMany" },
    { "from": "Workspace", "to": "Application", "type": "OneToMany", "index": true },
    { "from": "Application", "to": "ApplicationService", "type": "OneToMany" },
    { "from": "Application", "to": "User", "type": "ManyToOne", "to_name": "owner" },
    { "from": "ApplicationService", "to": "ApplicationServiceApiKey", "type": "OneToMany" },
    { "from": "ApplicationService", "to": "ApplicationServiceMetric", "type": "OneToMany" },
    { "from": "ApplicationService", "to": "InfrastructureStack", "type": "ManyToOne", "to_name": "networkStack", "nullable": true },
    { "from": "ApplicationService", "to": "InfrastructureStack", "type": "ManyToOne", "to_name": "databaseStack", "nullable": true },
    { "from": "InfrastructureStack", "to": "InfrastructureStack", "type": "ManyToOne", "to_name": "networkStack", "nullable": true }
  ],
  "entities": [
    {
      "name": "User",
      "created_at": true,
      "updated_at": true,
      "fields": [
        { "name": "cognito_id", "type": "text", "unique": true },
        { "name": "email", "type": "text", "length": 255, "is_email": true },
        { "name": "fullName", "type": "text", "nullable": true }
      ]
    },
    {
      "name": "Workspace",
      "created_at": true,
      "updated_at": true,
      "fields": [
        { "name": "name", "type": "text" }
      ]
    },
    {
      "name": "WorkspaceUser",
      "created_at": true,
      "updated_at": true,
      "fields": [
        { "name": "email", "type": "text", "length": 255, "is_email": true },
        { "name": "invite_code", "type": "text", "length": 64 },
        { "name": "role", "type": "enum", "values": ["User", "Admin"], "default": "Admin" },
        { "name": "status", "type": "enum", "values": ["Active", "Invited", "Inactive", "Deleted"] },
        { "name": "activeAt", "type": "date", "nullable": true }
      ]
    },
    {
      "name": "Application",
      "created_at": true,
      "updated_at": true,
      "fields": [
        { "name": "name", "type": "text" },
        { "name": "status", "type": "enum", "values": ["Active", "Deleted"] }
      ]
    }
    // ... more entities as needed ...
  ]
}
```

For a full example, see [`apso-cli/test/apsorc-json/apsorc.v2.json`](./test/apsorc-json/apsorc.v2.json).

## Auto-Generated Code Reference

This section details the code that Apso CLI automatically generates from your `.apsorc` configuration, including fields, TypeORM mappings, validation, and naming conventions. Understanding these rules will help you predict and control your generated backend code.

### 1. Auto-Generated Fields

#### Primary Keys
- Every entity automatically receives an `id` field, even if not defined in the `fields` array.
- Decorated as `@PrimaryGeneratedColumn()` (auto-incrementing integer).
- Type: `number`.

  ```typescript
  @PrimaryGeneratedColumn()
  id: number;
  ```

#### Timestamps
- If `"created_at": true` is set on the entity, generates:
  ```typescript
  @CreateDateColumn()
  created_at: Date;
  ```
- If `"updated_at": true` is set on the entity, generates:
  ```typescript
  @UpdateDateColumn()
  updated_at: Date;
  ```
- These are in addition to any fields you define.

#### Foreign Key Fields
- For each relationship, Apso generates the foreign key column and TypeORM decorators.
- Example:
  ```json
  { "from": "Workspace", "to": "User", "type": "ManyToOne", "to_name": "owner" }
  ```
  Generates:
  ```typescript
  @ManyToOne(() => User)
  @JoinColumn({ name: 'ownerId' })
  owner: User;

  @Column({ type: 'integer' })
  ownerId: number;
  ```

### 2. Field Type Mapping Table

> **⚠️ PostGIS Requirements:** The following spatial data types require the PostGIS extension to be installed in your PostgreSQL database:
> ```sql
> CREATE EXTENSION IF NOT EXISTS postgis;
> ```
> Ensure PostGIS is installed before using any of the spatial data types listed below.

| Apso Field Type | TypeORM Column Decorator                | Auto-Applied Validation                | Notes                                 |
|-----------------|-----------------------------------------|----------------------------------------|---------------------------------------|
| `text`          | `@Column({ type: 'text' })`             | `@IsString()`, `@IsNotEmpty()`         | With `length`: `@MaxLength(n)`        |
| `json`          | `@Column('jsonb')`                      | None                                   | Uses JSONB in PostgreSQL              |
| `enum`          | `@Column({ type: 'enum', enum: [...] })`| None                                   | Values array becomes enum             |
| `boolean`       | `@Column({ type: 'boolean' })`          | `@IsBoolean()`                         | Default values supported              |
| `integer`       | `@Column({ type: 'integer' })`          | `@IsNumber()`                          |                                       |
| `decimal`       | `@Column({ type: 'decimal', precision: n, scale: m })` | `@IsNumber()`                          | Precision/scale supported             |
| `numeric`       | `@Column({ type: 'numeric', precision: n, scale: m })` | `@IsNumber()`                          | Precision/scale supported             |
| `timestamp`     | `@Column({ type: 'timestamp' })`        | None                                   |                                       |
| `point`         | `@Column({ type: 'point' })`            | None                                   | PostGIS point geometry ⚠️ Requires PostGIS |
| `linestring`    | `@Column({ type: 'linestring' })`       | None                                   | PostGIS line string geometry ⚠️ Requires PostGIS |
| `polygon`       | `@Column({ type: 'polygon' })`          | None                                   | PostGIS polygon geometry ⚠️ Requires PostGIS |
| `multipoint`    | `@Column({ type: 'multipoint' })`       | None                                   | PostGIS multi-point geometry ⚠️ Requires PostGIS |
| `multilinestring` | `@Column({ type: 'multilinestring' })`  | None                                   | PostGIS multi-line string geometry ⚠️ Requires PostGIS |
| `multipolygon`  | `@Column({ type: 'multipolygon' })`     | None                                   | PostGIS multi-polygon geometry ⚠️ Requires PostGIS |
| `geometry`      | `@Column({ type: 'geometry' })`         | None                                   | PostGIS generic geometry type ⚠️ Requires PostGIS |
| `geography`     | `@Column({ type: 'geography' })`        | None                                   | PostGIS geography type ⚠️ Requires PostGIS |
| `geometrycollection` | `@Column({ type: 'geometrycollection' })` | None                              | PostGIS geometry collection ⚠️ Requires PostGIS |

#### Decimal/Numeric Field Examples

**Basic decimal field:**
```json
{
  "name": "price",
  "type": "decimal",
  "precision": 10,
  "scale": 2,
  "default": 0,
  "nullable": false
}
```
Generates:
```typescript
@Column({ "type": "decimal", precision: 10, scale: 2, default: 0 })
price: number;
```

**Numeric field with custom precision:**
```json
{
  "name": "bandwidth_gb",
  "type": "numeric",
  "precision": 10,
  "scale": 3,
  "default": 0,
  "nullable": false
}
```
Generates:
```typescript
@Column({ "type": "numeric", precision: 10, scale: 3, default: 0 })
bandwidth_gb: number;
```

#### PostGIS Field Examples

> **📋 PostGIS Setup Required:** Before using any PostGIS data types, ensure your PostgreSQL database has the PostGIS extension installed:
> ```sql
> -- Install PostGIS extension
> CREATE EXTENSION IF NOT EXISTS postgis;
> 
> -- Verify installation
> SELECT PostGIS_Version();
> ```
> 
> **Deployment Note:** When deploying applications with PostGIS fields, ensure the PostGIS extension is available in your production database environment.

**Point geometry field:**
```json
{
  "name": "location",
  "type": "point",
  "nullable": true
}
```
Generates:
```typescript
@Column({
  "type": "point",
  transformer: {
    to: (point: {x: number, y: number} | null) => {
      if (!point) return null;
      return `(${point.x},${point.y})`;
    },
    from: (pgPoint: string | null) => {
      if (!pgPoint) return null;
      const [x, y] = pgPoint.substring(1, pgPoint.length - 1).split(',');
      return { x: parseFloat(x), y: parseFloat(y) };
    }
  },
  nullable: true
})
location: { x: number, y: number };
```

**Polygon geometry field:**
```json
{
  "name": "boundary",
  "type": "polygon",
  "nullable": true
}
```
Generates:
```typescript
@Column({
  "type": "polygon",
  transformer: {
    to: (polygon: { coordinates: Array<Array<{x: number, y: number}>> } | null) => {
      if (!polygon) return null;
      const rings = polygon.coordinates.map(ring => {
        const coords = ring.map(coord => `${coord.x} ${coord.y}`).join(',');
        return `(${coords})`;
      });
      return `POLYGON(${rings.join(',')})`;
    },
    from: (pgPolygon: string | null) => {
      if (!pgPolygon) return null;
      const match = pgPolygon.match(/POLYGON\((.+)\)/);
      if (!match) return null;
      const rings = match[1].split('),(').map(ring => {
        const cleanRing = ring.replace(/[()]/g, '');
        const coords = cleanRing.split(',').map(coord => {
          const [x, y] = coord.trim().split(' ');
          return { x: parseFloat(x), y: parseFloat(y) };
        });
        return coords;
      });
      return { coordinates: rings };
    }
  },
  nullable: true
})
boundary: { coordinates: Array<Array<{ x: number, y: number }>> };
```

**Generic geometry field:**
```json
{
  "name": "shape",
  "type": "geometry",
  "nullable": true
}
```
Generates:
```typescript
@Column({
  "type": "geometry",
  transformer: {
    to: (geometry: any) => {
      if (!geometry) return null;
      return geometry;
    },
    from: (pgGeometry: any) => {
      if (!pgGeometry) return null;
      return pgGeometry;
    }
  },
  nullable: true
})
shape: any;
```

### 3. Validation Rules Documentation

Field properties in `.apsorc` map to validation decorators as follows:

- `"unique": true` → `@Column({ unique: true })`
- `"nullable": true` → `@Column({ nullable: true })` and `@IsOptional()`
- `"is_email": true` → `@IsEmail()`
- `"length": 255` → `@MaxLength(255)`
- `"precision": 10` → `@Column({ precision: 10 })` (for decimal/numeric types)
- `"scale": 2` → `@Column({ scale: 2 })` (for decimal/numeric types)
- `"required": false` → `@IsOptional()` (for CREATE group)

### 4. Relationship Generation Rules

#### OneToMany Relationships

```json
{ "from": "User", "to": "Workspace", "type": "OneToMany", "to_name": "ownedWorkspaces" }
```
Generates:
```typescript
@OneToMany(() => Workspace, (workspace) => workspace.user)
ownedWorkspaces: Workspace[];
```

#### ManyToOne Relationships

```json
{ "from": "Workspace", "to": "User", "type": "ManyToOne", "to_name": "owner" }
```
Generates:
```typescript
@ManyToOne(() => User, (user) => user.ownedWorkspaces)
@JoinColumn({ name: 'userId' })
owner: User;

@Column({ type: 'integer' })
userId: number;
```

#### Foreign Key Naming
- Foreign key columns use camelCase + `Id` (e.g., `userId`).
- Join column names match the foreign key column name.

### 5. Entity Naming Conventions
- Entity class names remain as defined in `.apsorc` (e.g., `User`).
- Table names are lowercased (e.g., `user`).
- Foreign key columns use camelCase + `Id` (e.g., `userId`).
- Join column names match the foreign key column name.

### 6. Version 2 Format Differences

Version 2 of the `.apsorc` format introduces several enhancements:
- Separate `relationships` and `entities` arrays.
- `created_at`/`updated_at` as boolean flags at the entity level.
- Enhanced field types: `json`, `enum`, `timestamp`, `decimal`, `numeric`.
- `to_name` property in relationships for custom property names.
- `precision` and `scale` properties for decimal/numeric fields.

Refer to the [example v2 file](#example-apsorc-v2-file) for usage.

## Relationships

### 1. Relationships Best Practices

> **Important:** Only define ONE side of a relationship in your `.apsorc` file. Apso CLI will auto-generate the inverse side for you. Defining both sides leads to duplicate properties, compilation errors, and entity conflicts.

#### DO/DON'T Examples

```json
// ❌ WRONG - Creates Conflicts:
{ "from": "User", "to": "Workspace", "type": "OneToMany" },
{ "from": "Workspace", "to": "User", "type": "ManyToOne" }

// ✅ CORRECT - One Side Only:
{ "from": "Workspace", "to": "User", "type": "ManyToOne", "to_name": "owner" }
```

- **DO:** Define only the direction that best fits your domain model.
- **DON'T:** Define both directions for the same relationship.
- **Why?** Apso CLI auto-generates the inverse property and decorators. Duplicating both sides causes duplicate property and foreign key generation.

### 2. Auto-Generated Properties Documentation

#### ManyToOne Relationships
- Generates:
  - Entity property with `@ManyToOne`, `@JoinColumn`, and `@Column` decorators
  - Foreign key column: `{relationName}Id`
  - Example:
    ```typescript
    @ManyToOne(() => User)
    @JoinColumn({ name: 'ownerId' })
    owner: User;

    @Column({ type: 'integer' })
    ownerId: number;
    ```

#### OneToMany Relationships
- Generates:
  - Array property with `@OneToMany` decorator
  - Inverse mapping to the ManyToOne property
  - Example:
    ```typescript
    @OneToMany(() => Workspace, (workspace) => workspace.owner)
    workspaces: Workspace[];
    ```

#### ManyToMany Relationships
- Generates:
  - Join table and array properties on both entities
  - Example:
    ```typescript
    @ManyToMany(() => Tag, (tag) => tag.posts)
    @JoinTable()
    tags: Tag[];
    ```
- **Warning:** If you define both a ManyToMany relationship and an explicit join entity, you may get duplicate join tables and properties. Prefer one approach.

### 3. Common Pitfalls and Solutions

#### Duplicate Identifier Errors
- **Cause:** Defining both sides of a relationship (bidirectional definitions)
- **Solution:** Remove one side; only define the relationship once.

#### "Property does not exist" Errors
- **Cause:** Referencing an inverse property that was not generated (e.g., using a `to_name` that doesn't match)
- **Solution:** Only use explicitly defined property names; check generated code for actual property names.

#### "Multiple properties with same name" Errors
- **Cause:** Complex or circular relationship chains, or duplicate relationship definitions
- **Solution:** Simplify relationships, avoid deep nesting, and ensure each relationship is defined only once.

#### ManyToMany + Explicit Join Entity Conflicts
- **Cause:** Defining both a ManyToMany and a join entity for the same relationship
- **Solution:** Use either a ManyToMany or a join entity, not both.

#### Circular Eager Loading Issues
- **Cause:** Deeply nested or circular relationships
- **Solution:** Limit eager loading, use lazy relations, and avoid unnecessary deep nesting in your model.

### 4. Relationship Patterns

#### Multi-Tenant Architecture
```json
{ "from": "Resource", "to": "Workspace", "type": "ManyToOne", "to_name": "workspace" },
{ "from": "Resource", "to": "User", "type": "ManyToOne", "to_name": "createdBy" }
```

#### Audit Trails, Deployment History, Optional Relationships
```json
{ "from": "Deployment", "to": "User", "type": "ManyToOne", "to_name": "deployedBy", "nullable": true },
{ "from": "AuditLog", "to": "Resource", "type": "ManyToOne", "to_name": "resource" }
```

#### ManyToMany Example
```json
{ "from": "User", "to": "Role", "type": "ManyToMany", "to_name": "roles" }
```

### 5. Testing and Validation Guide

- **Validate Relationship Generation:**
  - After running `apso server scaffold`, inspect the generated entity files in the `autogen` directory (never modify these directly—see above for extension instructions).
  - Check that only one property exists for each relationship per entity.
  - Confirm that foreign key columns and decorators are present as expected.

- **Build Testing Procedures:**
  - Run `tsc` or your build process to catch duplicate or missing property errors early.
  - Write unit tests for entity relationships if possible.

- **Entity Inspection Checklist:**
  - No duplicate properties or foreign keys
  - All relationships have the correct decorators
  - No circular imports or eager loading loops

- **Clean Regeneration Practices:**
  - Before re-scaffolding, remove old generated code:
    ```sh
    rm -rf autogen
    apso server scaffold
    ```
  This prevents stale or duplicate files from causing errors. **Never add custom code to autogen—use extensions as described above.**

### 6. Version 2 Format Clarity

- In v2, relationships and entities are defined in separate arrays:
  ```json
  {
    "version": 2,
    "entities": [ ... ],
    "relationships": [ ... ]
  }
  ```
- Each relationship should only be defined once, with clear `to_name` if you want a custom property name.
- Field types and validation are specified per the [Auto-Generated Code Reference](#auto-generated-code-reference).

> **Summary:**
>
> - Only define one side of each relationship in `.apsorc`.
> - Let Apso CLI auto-generate the inverse side.
> - Avoid deep nesting and duplicate definitions.
> - Always inspect generated code and test your build after scaffolding.

## Authentication (Bring Your Own Auth)

Apso provides flexible, provider-agnostic authentication that generates NestJS guards from your `.apsorc` configuration. Unlike monolithic platforms that force vendor lock-in through proprietary auth systems, Apso embraces **code ownership** - you choose your auth provider, and you own the generated code.

### Philosophy: Why Bring Your Own Auth Matters

Traditional BaaS platforms like Supabase and Firebase provide authentication as a core feature, but this creates dependency:
- Your user data lives in their systems
- Migrating away requires rewriting auth logic
- You're bound to their pricing, features, and roadmap

**Apso takes a different approach:**
- **Provider flexibility** - Use Better Auth, Auth0, Cognito, Clerk, or custom solutions
- **Code ownership** - Generated guards are standard NestJS code you can inspect, modify, and extend
- **Zero lock-in** - Switch providers by changing configuration, not rewriting code
- **Normalized interface** - All providers produce the same `AuthContext` consumed by scoping and RBAC

This philosophy ensures your authentication layer is **timeless** - it grows with your needs and migrates with your stack.

### Supported Authentication Providers

| Provider | Type | Best For |
|----------|------|----------|
| `better-auth` | Database Sessions | Self-hosted apps, maximum control |
| `custom-db-session` | Database Sessions | Existing session tables, custom flows |
| `auth0` | JWT | Enterprise SSO, social login |
| `clerk` | JWT | Modern SaaS with prebuilt UI |
| `cognito` | JWT | AWS ecosystem integration |
| `api-key` | API Keys | Service-to-service auth, public APIs |

### Basic Configuration

Add an `auth` block to your `.apsorc`:

```json
{
  "version": 2,
  "auth": {
    "provider": "better-auth"
  },
  "entities": [...]
}
```

Run `apso server scaffold` to generate the auth guard.

### Provider-Specific Configuration

#### Better Auth / Custom DB Sessions

For database-backed session authentication:

```json
{
  "auth": {
    "provider": "better-auth",
    "sessionEntity": "session",
    "userEntity": "User",
    "accountUserEntity": "AccountUser",
    "cookiePrefix": "myapp",
    "organizationField": "organizationId",
    "roleField": "role"
  }
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `sessionEntity` | `"session"` | Entity storing session tokens |
| `userEntity` | `"User"` | Entity for user accounts |
| `accountUserEntity` | `"AccountUser"` | Junction entity for user-org mapping |
| `cookiePrefix` | service name | Cookie name prefix (e.g., `myapp.session_token`) |
| `organizationField` | `"organizationId"` | Field on accountUserEntity for org ID |
| `roleField` | `"role"` | Field on accountUserEntity for user role |

#### JWT Providers (Auth0, Clerk, Cognito)

For JWT-based authentication:

```json
{
  "auth": {
    "provider": "auth0",
    "jwt": {
      "issuer": "https://your-tenant.auth0.com/",
      "audience": "https://your-api.example.com",
      "jwksUri": "https://your-tenant.auth0.com/.well-known/jwks.json",
      "algorithms": ["RS256"]
    },
    "claims": {
      "userId": "sub",
      "email": "email",
      "organizationId": "org_id",
      "roles": "permissions"
    }
  }
}
```

| JWT Option | Default | Description |
|------------|---------|-------------|
| `issuer` | Required | JWT issuer URL |
| `audience` | Required | Expected JWT audience |
| `jwksUri` | `issuer + /.well-known/jwks.json` | JWKS endpoint for key rotation |
| `algorithms` | `["RS256"]` | Accepted signing algorithms |

| Claims Option | Default | Description |
|---------------|---------|-------------|
| `userId` | `"sub"` | Claim containing user ID |
| `email` | `"email"` | Claim containing user email |
| `organizationId` | - | Claim for org/workspace ID |
| `roles` | `"roles"` | Claim containing role array |

#### API Key Authentication

For service-to-service or public API authentication:

```json
{
  "auth": {
    "provider": "api-key",
    "apiKeyHeader": "x-api-key",
    "apiKeyEntity": "ApiKey",
    "workspaceField": "workspaceId",
    "roleField": "permissions"
  }
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `apiKeyHeader` | `"x-api-key"` | Header name for API key |
| `apiKeyEntity` | `"ApiKey"` | Entity storing API keys |
| `workspaceField` | - | Field on entity for workspace ID |
| `roleField` | - | Field on entity for permissions |

### The AuthContext Interface

All auth providers produce a normalized `AuthContext` that's attached to every authenticated request:

```typescript
interface AuthContext {
  userId?: string;           // The authenticated user's ID
  email?: string;            // User's email (if available)
  workspaceId?: string;      // Workspace/tenant ID
  organizationId?: string;   // Organization ID (alias)
  roles: string[];           // User's roles/permissions
  serviceId?: string;        // For API key auth: the key identifier
  user?: unknown;            // Raw user object (provider-specific)
  session?: unknown;         // Raw session object (provider-specific)
}
```

This normalization is powerful - your business logic works with the same interface regardless of whether you're using Auth0 JWTs or Better Auth sessions.

### Generated Files

When `auth` is configured, `apso server scaffold` generates:

```
src/
  guards/
    auth.guard.ts       # Authentication guard implementation
    scope.guard.ts      # Data scoping guard (if scopeBy used)
    guards.module.ts    # NestJS module with providers
    index.ts            # Exports
```

### Enabling Authentication

Guards are generated but **not enabled globally by default**. Enable them based on your needs:

#### Option 1: Global Enable (Recommended for most apps)

Edit `src/guards/guards.module.ts`:

```typescript
providers: [
  AuthGuard,
  ScopeGuard,
  // Uncomment to enable globally:
  {
    provide: APP_GUARD,
    useClass: AuthGuard,
  },
  {
    provide: APP_GUARD,
    useClass: ScopeGuard,
  },
],
```

#### Option 2: Controller-Level Enable

```typescript
import { AuthGuard } from '../guards';

@UseGuards(AuthGuard)
@Controller('projects')
export class ProjectController { }
```

#### Option 3: Route-Level Enable

```typescript
@UseGuards(AuthGuard)
@Get('me')
getProfile(@Req() req: AuthenticatedRequest) {
  return req.auth;
}
```

### Decorators

```typescript
import { Public, SkipScopeCheck } from './guards';

// Skip ALL guards (no authentication required)
@Public()
@Get('health')
healthCheck() { }

// Skip only scope checking (auth still required)
@SkipScopeCheck()
@Get('admin/stats')
adminStats() { }
```

### Accessing Auth Context

In controllers and services, access the authenticated context:

```typescript
import { AuthenticatedRequest, getAuthContext, requireAuthContext } from './guards';

@Controller('projects')
export class ProjectController {
  @Get()
  findAll(@Req() req: AuthenticatedRequest) {
    // Direct access
    const userId = req.auth.userId;
    const orgId = req.auth.organizationId;

    // Or use helpers
    const ctx = requireAuthContext(req); // Throws if not authenticated
    return this.projectService.findByOrg(ctx.organizationId);
  }
}
```

### Token Extraction

The generated auth guard extracts tokens from multiple locations (in order):

1. **Authorization header**: `Bearer <token>`
2. **Cookies**: `{cookiePrefix}.session_token`, `better-auth.session_token`, or `session_token`
3. **Custom header**: `X-Session-Token`

This flexibility supports both browser-based apps (cookies) and API clients (headers).

### Complete Example

```json
{
  "version": 2,
  "auth": {
    "provider": "better-auth",
    "sessionEntity": "session",
    "userEntity": "User",
    "accountUserEntity": "AccountUser",
    "cookiePrefix": "myapp",
    "organizationField": "organizationId",
    "roleField": "role"
  },
  "entities": [
    {
      "name": "User",
      "fields": [
        { "name": "email", "type": "text", "unique": true },
        { "name": "name", "type": "text", "nullable": true }
      ]
    },
    {
      "name": "session",
      "fields": [
        { "name": "token", "type": "text", "unique": true },
        { "name": "expiresAt", "type": "timestamp" },
        { "name": "userId", "type": "text" }
      ]
    },
    {
      "name": "Organization",
      "fields": [
        { "name": "name", "type": "text" }
      ]
    },
    {
      "name": "AccountUser",
      "fields": [
        { "name": "role", "type": "enum", "values": ["owner", "admin", "member"] }
      ]
    },
    {
      "name": "Project",
      "scopeBy": "organizationId",
      "fields": [
        { "name": "name", "type": "text" }
      ]
    }
  ],
  "relationships": [
    { "from": "AccountUser", "to": "User", "type": "ManyToOne" },
    { "from": "AccountUser", "to": "Organization", "type": "ManyToOne" },
    { "from": "Project", "to": "Organization", "type": "ManyToOne" }
  ]
}
```

### Migrating Between Providers

One of Apso's key advantages is seamless provider migration:

1. Update the `auth` block in `.apsorc`
2. Run `apso server scaffold`
3. Update your frontend to use the new provider's login flow

Your business logic remains unchanged because it only interacts with the normalized `AuthContext`.

---

## Data Scoping (Multi-Tenant Isolation)

Apso provides application-layer data isolation that rivals PostgreSQL's Row-Level Security (RLS) - but with greater flexibility, visibility, and portability. This is Apso's answer to one of the most critical challenges in SaaS development: ensuring users only see and modify data they're authorized to access.

### Philosophy: Application-Layer RLS

Traditional approaches to multi-tenant data isolation include:
- **Database RLS (Supabase)** - Powerful but opaque, tied to PostgreSQL, difficult to debug
- **Manual filtering** - Error-prone, repetitive, easy to forget on new endpoints
- **ORM middleware** - Often complex, hard to customize

**Apso's approach delivers the best of all worlds:**
- **Declarative** - Define scope once in `.apsorc`, applied everywhere
- **Transparent** - Generated guards are standard NestJS code you can inspect and debug
- **Portable** - Works with any database, not locked to PostgreSQL RLS
- **Flexible** - Configure per-entity behavior: auto-injection, filtering, bypass rules

This design is **timeless** - your data isolation logic is explicit code, not hidden database magic.

### What is scopeBy?

The `scopeBy` property on entities defines which field(s) determine the authorization scope for that entity. When configured, Apso generates NestJS guards that:

- **Auto-inject** scope values on create operations (POST requests)
- **Auto-filter** queries by scope values on list operations (GET without ID)
- **Verify ownership** on single-resource operations (GET/PUT/PATCH/DELETE by ID)

This is Apso's answer to PostgreSQL Row-Level Security (RLS), implemented at the application layer for flexibility and visibility.

### Basic Example

```json
{
  "version": 2,
  "entities": [
    {
      "name": "Project",
      "scopeBy": "workspaceId",
      "fields": [
        { "name": "name", "type": "text" }
      ]
    }
  ]
}
```

This generates a guard that ensures:
- All Project queries filter by `workspaceId` from the request context
- New Projects automatically get the `workspaceId` injected
- Single Project access verifies the Project belongs to the user's workspace

### scopeBy Configuration Options

#### Single Field Scoping
```json
{
  "name": "Project",
  "scopeBy": "workspaceId"
}
```

#### Multiple Field Scoping
```json
{
  "name": "Task",
  "scopeBy": ["workspaceId", "projectId"]
}
```

#### Nested Path Scoping
For entities that don't have a direct scope field but inherit scope through a relationship:
```json
{
  "name": "Comment",
  "scopeBy": "task.workspaceId"
}
```
This tells the guard to look up the Task relationship and verify the workspaceId through that path.

### scopeOptions

Fine-tune scoping behavior with `scopeOptions`:

```json
{
  "name": "AuditLog",
  "scopeBy": "workspaceId",
  "scopeOptions": {
    "injectOnCreate": false,
    "enforceOn": ["find", "get"],
    "bypassRoles": ["admin", "superadmin"]
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `injectOnCreate` | boolean | `true` | Auto-inject scope value on POST requests |
| `enforceOn` | string[] | `["find", "get", "create", "update", "delete"]` | Operations where scope is enforced |
| `bypassRoles` | string[] | `[]` | Roles that skip scope checking |

### Generated Files

When entities have `scopeBy` configured, `apso server scaffold` generates:

```
src/
  guards/
    scope.guard.ts      # Main guard implementation
    guards.module.ts    # NestJS module with providers
    index.ts            # Exports
```

### Enabling Guards

Guards are generated but **not enabled globally by default** (for backward compatibility). To enable:

#### Option 1: Global Enable (Recommended)
Uncomment the APP_GUARD provider in `src/guards/guards.module.ts`:

```typescript
providers: [
  ScopeGuard,
  // Uncomment to enable globally:
  {
    provide: APP_GUARD,
    useClass: ScopeGuard,
  },
],
```

#### Option 2: Per-Controller Enable
Apply to specific controllers:

```typescript
import { ScopeGuard } from '../guards';

@UseGuards(ScopeGuard)
@Controller('projects')
export class ProjectController { }
```

#### Option 3: Per-Route Enable
Apply to specific routes:

```typescript
@UseGuards(ScopeGuard)
@Get(':id')
findOne(@Param('id') id: string) { }
```

### Decorators

The generated guard supports these decorators:

```typescript
import { Public, SkipScopeCheck } from './guards';

@Public()  // Skip ALL guards for this route
@Get('public-endpoint')
publicRoute() { }

@SkipScopeCheck()  // Skip only scope checking (other guards still run)
@Get('admin-dashboard')
adminRoute() { }
```

### Request Context Integration

The guard expects scope values in the request object. Set these in your authentication middleware:

```typescript
// In your auth middleware
request.workspaceId = user.currentWorkspaceId;
request.user = { roles: ['user'] };
```

### Complete Example

```json
{
  "version": 2,
  "entities": [
    {
      "name": "Workspace",
      "fields": [{ "name": "name", "type": "text" }]
    },
    {
      "name": "Project",
      "scopeBy": "workspaceId",
      "fields": [{ "name": "name", "type": "text" }]
    },
    {
      "name": "Task",
      "scopeBy": ["workspaceId", "projectId"],
      "fields": [{ "name": "title", "type": "text" }]
    },
    {
      "name": "Comment",
      "scopeBy": "task.workspaceId",
      "scopeOptions": {
        "enforceOn": ["find", "get", "create", "delete"]
      },
      "fields": [{ "name": "text", "type": "text" }]
    }
  ],
  "relationships": [
    { "from": "Project", "to": "Workspace", "type": "ManyToOne" },
    { "from": "Task", "to": "Project", "type": "ManyToOne" },
    { "from": "Comment", "to": "Task", "type": "ManyToOne" }
  ]
}
```

### Scoping vs Authorization

**Scoping** (what `scopeBy` provides):
- Answers: "Which rows can this user see/modify?"
- Data isolation based on tenant/workspace membership
- Automatic filtering and injection

**Authorization** (separate concern, not covered by `scopeBy`):
- Answers: "Can this user perform this action?"
- Role-based access control (RBAC)
- Permission checking (create, read, update, delete)

These are intentionally separate. Use `scopeBy` for data isolation, and implement authorization guards separately for permission checking.

---

## Authentication + Scoping: Working Together

Auth and Scoping are designed to work together seamlessly. This combined system delivers enterprise-grade security with minimal configuration.

### How They Connect

When both `auth` and `scopeBy` are configured:

1. **AuthGuard runs first** - Validates the session/token and populates `request.auth`
2. **ScopeGuard runs second** - Reads `organizationId`/`workspaceId` from `request.auth` and enforces isolation

The `AuthContext` automatically provides the scope values that `scopeBy` needs:

```typescript
// AuthGuard sets this on every authenticated request:
request.auth = {
  userId: "user_123",
  organizationId: "org_456",  // <-- ScopeGuard uses this
  workspaceId: "org_456",     // <-- Or this (alias)
  roles: ["admin"],
  // ...
}

// ScopeGuard then uses organizationId to:
// - Filter GET /projects -> only org_456's projects
// - Inject on POST /projects -> auto-set organizationId
// - Verify on GET /projects/:id -> ensure it belongs to org_456
```

### Complete Multi-Tenant Example

```json
{
  "version": 2,
  "auth": {
    "provider": "better-auth",
    "sessionEntity": "session",
    "userEntity": "User",
    "accountUserEntity": "AccountUser",
    "organizationField": "organizationId"
  },
  "entities": [
    {
      "name": "User",
      "fields": [
        { "name": "email", "type": "text", "unique": true },
        { "name": "name", "type": "text", "nullable": true }
      ]
    },
    {
      "name": "session",
      "fields": [
        { "name": "token", "type": "text", "unique": true },
        { "name": "expiresAt", "type": "timestamp" },
        { "name": "userId", "type": "text" }
      ]
    },
    {
      "name": "Organization",
      "fields": [
        { "name": "name", "type": "text" },
        { "name": "plan", "type": "enum", "values": ["free", "pro", "enterprise"] }
      ]
    },
    {
      "name": "AccountUser",
      "fields": [
        { "name": "role", "type": "enum", "values": ["owner", "admin", "member"] }
      ]
    },
    {
      "name": "Project",
      "scopeBy": "organizationId",
      "fields": [
        { "name": "name", "type": "text" },
        { "name": "status", "type": "enum", "values": ["active", "archived"] }
      ]
    },
    {
      "name": "Task",
      "scopeBy": ["organizationId", "projectId"],
      "fields": [
        { "name": "title", "type": "text" },
        { "name": "completed", "type": "boolean", "default": false }
      ]
    },
    {
      "name": "AuditLog",
      "scopeBy": "organizationId",
      "scopeOptions": {
        "injectOnCreate": true,
        "enforceOn": ["find", "get"],
        "bypassRoles": ["superadmin"]
      },
      "fields": [
        { "name": "action", "type": "text" },
        { "name": "details", "type": "json" }
      ]
    }
  ],
  "relationships": [
    { "from": "AccountUser", "to": "User", "type": "ManyToOne" },
    { "from": "AccountUser", "to": "Organization", "type": "ManyToOne" },
    { "from": "Project", "to": "Organization", "type": "ManyToOne" },
    { "from": "Task", "to": "Project", "type": "ManyToOne" },
    { "from": "Task", "to": "Organization", "type": "ManyToOne" },
    { "from": "AuditLog", "to": "Organization", "type": "ManyToOne" }
  ]
}
```

### Guard Execution Order

Enable both guards globally for automatic protection:

```typescript
// src/guards/guards.module.ts
providers: [
  AuthGuard,
  ScopeGuard,
  {
    provide: APP_GUARD,
    useClass: AuthGuard,    // Runs first
  },
  {
    provide: APP_GUARD,
    useClass: ScopeGuard,   // Runs second
  },
],
```

### The Apso Security Stack

| Layer | Guard | Question Answered | Configuration |
|-------|-------|-------------------|---------------|
| 1. Identity | AuthGuard | "Who is this user?" | `auth` in `.apsorc` |
| 2. Isolation | ScopeGuard | "Which data can they see?" | `scopeBy` on entities |
| 3. Authorization | (Your implementation) | "What actions can they take?" | Custom RBAC guard |

Apso handles layers 1 and 2 automatically. Layer 3 (fine-grained permissions like "can edit this specific resource") is left to your business logic since it varies widely between applications.

### Why This Matters: The Supabase Comparison

| Feature | Supabase | Apso |
|---------|----------|------|
| **Auth** | Built-in, proprietary | Bring your own, code you own |
| **Data Isolation** | PostgreSQL RLS (opaque) | Application-layer guards (transparent) |
| **Portability** | Locked to Supabase | Works with any database |
| **Debugging** | Database logs, hard to trace | Standard NestJS code, full visibility |
| **Customization** | Limited to RLS policies | Unlimited - it's your code |
| **Migration Path** | Rewrite required | Change config, regenerate |

Apso delivers equivalent functionality to Supabase's auth + RLS combo, but with:
- **Full code ownership** - No vendor lock-in
- **Provider flexibility** - Auth0, Clerk, Cognito, or self-hosted
- **Database freedom** - PostgreSQL, MySQL, MongoDB, or any TypeORM-supported database
- **Complete transparency** - Debug with standard tools, not vendor-specific dashboards

This architecture is **timeless** - it grows with your needs, migrates with your stack, and remains fully under your control.

---

## Schema Reference

The `.apsorc` file must conform to the [APSO Configuration Schema](./apsorc.schema.json). This schema defines all valid properties, types, and constraints for your configuration file.

### Inline Schema (apsorc.schema.json)

```json
// ... see full contents in apso-cli/apsorc.schema.json ...
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "APSO Configuration Schema",
  "description": "Schema for the .apsorc file used by APSO to define entities and relationships.",
  // ... (truncated for brevity) ...
}
```

See the [full schema file](./apsorc.schema.json) for all details and validation rules.

## Debugging

For debugging we would use the debug package so you need to import the package in file where you want to debug any code.

```sh-session
var debug = require("debug")("{name of your choice}");
```

Then just add the debug statements wherever you want.

```sh-session
debug(`variable1 value is:`, variable1);
```

Now inorder to see the debug output you need to run the cli in debug mode like this.

```sh-session
env DEBUG=\* ./bin/run server scaffold
```

So we are setting the env variable DEBUG and then giving the path of the bin/run file and then next will be your cli commmand.

Note: Whenever you make a change you need to rebuild the cli before running it in order to reflect the changes.

```sh-session
npm run build
```

# Commands

- [`apso help [COMMANDS]`](#apso-help-commands)
- [`apso plugins`](#apso-plugins)
- [`apso plugins:install PLUGIN...`](#apso-pluginsinstall-plugin)
- [`apso plugins:inspect PLUGIN...`](#apso-pluginsinspect-plugin)
- [`apso plugins:install PLUGIN...`](#apso-pluginsinstall-plugin-1)
- [`apso plugins:link PLUGIN`](#apso-pluginslink-plugin)
- [`apso plugins:uninstall PLUGIN...`](#apso-pluginsuninstall-plugin)
- [`apso plugins:uninstall PLUGIN...`](#apso-pluginsuninstall-plugin-1)
- [`apso plugins:uninstall PLUGIN...`](#apso-pluginsuninstall-plugin-2)
- [`apso plugins update`](#apso-plugins-update)

## `apso help [COMMANDS]`

Display help for apso.

```
USAGE
  $ apso help [COMMANDS] [-n]

ARGUMENTS
  COMMANDS  Command to show help for.

FLAGS
  -n, --nested-commands  Include all nested commands in the output.

DESCRIPTION
  Display help for apso.
```

_See code: [@oclif/plugin-help](https://github.com/oclif/plugin-help/blob/v5.2.9/src/commands/help.ts)_

## `apso plugins`

List installed plugins.

```
USAGE
  $ apso plugins [--json] [--core]

FLAGS
  --core  Show core plugins.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  List installed plugins.

EXAMPLES
  $ apso plugins
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v3.1.2/src/commands/plugins/index.ts)_

## `apso plugins:install PLUGIN...`

Installs a plugin into the CLI.

```
USAGE
  $ apso plugins:install PLUGIN...

ARGUMENTS
  PLUGIN  Plugin to install.

FLAGS
  -f, --force    Run yarn install with force flag.
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Installs a plugin into the CLI.
  Can be installed from npm or a git url.

  Installation of a user-installed plugin will override a core plugin.

  e.g. If you have a core plugin that has a 'hello' command, installing a user-installed plugin with a 'hello' command
  will override the core plugin implementation. This is useful if a user needs to update core plugin functionality in
  the CLI without the need to patch and update the whole CLI.


ALIASES
  $ apso plugins add

EXAMPLES
  $ apso plugins:install myplugin

  $ apso plugins:install https://github.com/someuser/someplugin

  $ apso plugins:install someuser/someplugin
```

## `apso plugins:inspect PLUGIN...`

Displays installation properties of a plugin.

```
USAGE
  $ apso plugins:inspect PLUGIN...

ARGUMENTS
  PLUGIN  [default: .] Plugin to inspect.

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Displays installation properties of a plugin.

EXAMPLES
  $ apso plugins:inspect myplugin
```

## `apso plugins:install PLUGIN...`

Installs a plugin into the CLI.

```
USAGE
  $ apso plugins:install PLUGIN...

ARGUMENTS
  PLUGIN  Plugin to install.

FLAGS
  -f, --force    Run yarn install with force flag.
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Installs a plugin into the CLI.
  Can be installed from npm or a git url.

  Installation of a user-installed plugin will override a core plugin.

  e.g. If you have a core plugin that has a 'hello' command, installing a user-installed plugin with a 'hello' command
  will override the core plugin implementation. This is useful if a user needs to update core plugin functionality in
  the CLI without the need to patch and update the whole CLI.


ALIASES
  $ apso plugins add

EXAMPLES
  $ apso plugins:install myplugin

  $ apso plugins:install https://github.com/someuser/someplugin

  $ apso plugins:install someuser/someplugin
```

## `apso plugins:link PLUGIN`

Links a plugin into the CLI for development.

```
USAGE
  $ apso plugins:link PLUGIN

ARGUMENTS
  PATH  [default: .] path to plugin

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Links a plugin into the CLI for development.
  Installation of a linked plugin will override a user-installed or core plugin.

  e.g. If you have a user-installed or core plugin that has a 'hello' command, installing a linked plugin with a 'hello'
  command will override the user-installed or core plugin implementation. This is useful for development work.


EXAMPLES
  $ apso plugins:link myplugin
```

## `apso plugins:uninstall PLUGIN...`

Removes a plugin from the CLI.

```
USAGE
  $ apso plugins:uninstall PLUGIN...

ARGUMENTS
  PLUGIN  plugin to uninstall

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Removes a plugin from the CLI.

ALIASES
  $ apso plugins unlink
  $ apso plugins remove
```

## `apso plugins:uninstall PLUGIN...`

Removes a plugin from the CLI.

```
USAGE
  $ apso plugins:uninstall PLUGIN...

ARGUMENTS
  PLUGIN  plugin to uninstall

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Removes a plugin from the CLI.

ALIASES
  $ apso plugins unlink
  $ apso plugins remove
```

## `apso plugins:uninstall PLUGIN...`

Removes a plugin from the CLI.

```
USAGE
  $ apso plugins:uninstall PLUGIN...

ARGUMENTS
  PLUGIN  plugin to uninstall

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Removes a plugin from the CLI.

ALIASES
  $ apso plugins unlink
  $ apso plugins remove
```

## `apso plugins update`

Update installed plugins.

```
USAGE
  $ apso plugins update [-h] [-v]

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Update installed plugins.
```
