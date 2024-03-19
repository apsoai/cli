# Apso CLI

<!-- toc -->
* [Apso CLI](#apso-cli)
* [Prerequisites](#prerequisites)
* [Usage](#usage)
* [Local Development](#local-development)
* [Commands](#commands)
<!-- tocstop -->

# Prerequisites

You need to have setup access to Mavric's private NPM packages.
Find out how [here](https://github.com/mavric/.github-private/blob/main/how-to/private-npm.md)

# Usage

<!-- usage -->
```sh-session
$ npm install -g @mavric/apso-cli
$ apso COMMAND
running command...
$ apso (--version)
@mavric/apso-cli/0.0.22 linux-x64 node-v18.19.1
$ apso --help [COMMAND]
USAGE
  $ apso COMMAND
...
```
<!-- usagestop -->

# Local Development

You need to clone both apso-cli and apso-service-template locally on your machine. Navigate to the apso-cli repo in your code editor and run the below command

```sh-session
$ npm run build && npm link
```

This will build the apso cli and make it available for use globally on your machine. Now make a new directory where you want to setup a new backend service. Run the below command in order to create a new service boilerplate.

```sh-session
$ apso server new -n <project-name>
```

Then navigate to the newly created service and update the apsorc file according to your project entities and relations. Sample of rc files for both v1 and v2 are given in apso-cli code at "test/apsorc-json" so you can check it out in order to make sure that your apsorc file follows the right pattern. Make sure to provide the desired value for the key "apiType" in the apsorc file e.g (Rest, Graphql).

Now we will run the scaffold command which will generate the all the relevant modules for us.

```sh-session
$ apso server scaffold
```

Note: Incase you face prettier related issues while running the scaffold command make sure that when you initailly created the service with "apso server new" command, the apso-service-template directory did not had node modules folder. Incase you do have a node modules folder present for some reason then delete it. Discard this service and make a new one and run the scaffold command in it.

# Commands

<!-- commands -->
* [`apso help [COMMANDS]`](#apso-help-commands)
* [`apso plugins`](#apso-plugins)
* [`apso plugins:install PLUGIN...`](#apso-pluginsinstall-plugin)
* [`apso plugins:inspect PLUGIN...`](#apso-pluginsinspect-plugin)
* [`apso plugins:install PLUGIN...`](#apso-pluginsinstall-plugin-1)
* [`apso plugins:link PLUGIN`](#apso-pluginslink-plugin)
* [`apso plugins:uninstall PLUGIN...`](#apso-pluginsuninstall-plugin)
* [`apso plugins:uninstall PLUGIN...`](#apso-pluginsuninstall-plugin-1)
* [`apso plugins:uninstall PLUGIN...`](#apso-pluginsuninstall-plugin-2)
* [`apso plugins update`](#apso-plugins-update)

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
<!-- commandsstop -->
