Apso CLI
=================

<!-- toc -->
* [Prerequisites](#prerequisites)
* [Usage](#usage)
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
@mavric/apso-cli/0.0.6 darwin-arm64 node-v16.15.1
$ apso --help [COMMAND]
USAGE
  $ apso COMMAND
...
```
<!-- usagestop -->
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
* [`apso server new [NAME]`](#apso-server-new-name)
* [`apso server scaffold`](#apso-server-scaffold)

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

_See code: [@oclif/plugin-help](https://github.com/oclif/plugin-help/blob/v5.2.7/src/commands/help.ts)_

## `apso plugins`

List installed plugins.

```
USAGE
  $ apso plugins [--core]

FLAGS
  --core  Show core plugins.

DESCRIPTION
  List installed plugins.

EXAMPLES
  $ apso plugins
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v2.4.0/src/commands/plugins/index.ts)_

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

## `apso server new [NAME]`

Initialize your server project

```
USAGE
  $ apso server new [NAME] [-n <value>]

FLAGS
  -n, --name=<value>  name of application

DESCRIPTION
  Initialize your server project

EXAMPLES
  $ apso server new --name TestProject
```

## `apso server scaffold`

Setup new entities and interfaces for an Apso Server

```
USAGE
  $ apso server scaffold [-h] [-m <value>]

FLAGS
  -h, --help            Show CLI help.
  -m, --entity=<value>  model name

DESCRIPTION
  Setup new entities and interfaces for an Apso Server

EXAMPLES
  $ apso server scaffold
```
<!-- commandsstop -->
