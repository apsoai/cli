Apso CLI
=================

<!-- toc -->
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
@mavric/apso-cli/0.0.1 darwin-x64 node-v18.14.0
$ apso --help [COMMAND]
USAGE
  $ apso COMMAND
...
```
<!-- usagestop -->
# Commands
<!-- commands -->
* [`apso help [COMMANDS]`](#apso-help-commands)
* [`apso server new --name [NAME]`](#apso-server-new-name)
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

_See code: [@oclif/plugin-help](https://github.com/oclif/plugin-help/blob/v5.2.4/src/commands/help.ts)_

## `apso server new --name [NAME]`

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

Setup new entities and interfaces for an Apso Service.  Run this command from an Apso project folder.  It will read and build the contents of your .apsorc file.

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
