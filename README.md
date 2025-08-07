# Apso CLI

- [Apso CLI](#apso-cli)
- [Prerequisites](#prerequisites)
- [Usage](#usage)
- [Local Development](#local-development)
- [Populating an .apsorc File](#populating-an-apsorc-file)
- [Auto-Generated Code Reference](#auto-generated-code-reference)
- [Debugging](##debugging)
- [Commands](#commands)


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
