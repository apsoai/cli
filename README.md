# Apso CLI

- [Apso CLI](#apso-cli)
- [Prerequisites](#prerequisites)
- [Usage](#usage)
- [Local Development](#local-development)
- [Populating an .apsorc File](#populating-an-apsorc-file)
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
