import { Flags } from "@oclif/core";
import BaseCommand from "../lib/base-command";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export default class Completion extends BaseCommand {
  static description = "Generate shell completion scripts";

  static examples = [
    "$ apso completion bash > ~/.apso-completion.sh",
    "$ apso completion zsh > ~/.apso-completion.zsh",
    "$ apso completion install bash",
    "$ apso completion install zsh",
  ];

  static flags = {
    shell: Flags.string({
      char: "s",
      description: "Shell type (bash or zsh)",
      options: ["bash", "zsh"],
      required: false,
    }),
  };

  static strict = false; // Allow unknown arguments

  async run(): Promise<void> {
    const { flags, argv } = await this.parse(Completion);
    const action = (argv[0] as string) || "generate";
    let shell = flags.shell;

    // Auto-detect shell if not provided
    if (!shell) {
      const shellEnv = process.env.SHELL || "";
      if (shellEnv.includes("zsh")) {
        shell = "zsh";
      } else if (shellEnv.includes("bash")) {
        shell = "bash";
      } else {
        // Default to bash on Windows, try to detect otherwise
        const platform = process.platform;
        shell = platform === "win32" ? "bash" : "bash"; // Git Bash or WSL, or default to bash
      }
      this.log(`Auto-detected shell: ${shell}`);
      this.log("(Use --shell flag to override)\n");
    }

    if (shell !== "bash" && shell !== "zsh") {
      this.error(
        "Shell must be 'bash' or 'zsh'. Please specify with --shell flag.\n\n" +
          "Examples:\n" +
          "  $ apso completion --shell bash\n" +
          "  $ apso completion --shell zsh\n" +
          "  $ apso completion --shell bash install"
      );
    }

    action === "install"
      ? await this.installCompletion(shell as "bash" | "zsh")
      : await this.generateCompletion(shell as "bash" | "zsh");
  }

  private async generateCompletion(shell: "bash" | "zsh"): Promise<void> {
    const commands = [
      "link",
      "list",
      "login",
      "logout",
      "pull",
      "push",
      "sync",
      "status",
      "diff",
      "queue",
      "doctor",
      "tui",
      "completion",
    ];

    if (shell === "bash") {
      this.generateBashCompletion(commands);
    } else {
      this.generateZshCompletion(commands);
    }
  }

  private generateBashCompletion(commands: string[]): void {
    /* eslint-disable no-template-curly-in-string */
    const script = `# Apso CLI bash completion
_apso_completion() {
  local cur prev opts
  COMPREPLY=()
  cur="${"${COMP_WORDS[COMP_CWORD]}"}"
  prev="${"${COMP_WORDS[COMP_CWORD-1]}"}"
  
  opts="${commands.join(" ")}"
  
  if [[ ${"${COMP_CWORD}"} == 1 ]]; then
    COMPREPLY=( $(compgen -W "${"${opts}"}" -- ${"${cur}"}) )
    return 0
  fi
  
  case ${"${prev}"} in
    link|list|pull|push|sync|status|diff|queue|doctor|tui)
      COMPREPLY=( $(compgen -W "" -- ${"${cur}"}) )
      ;;
    *)
      COMPREPLY=( $(compgen -W "${"${opts}"}" -- ${"${cur}"}) )
      ;;
  esac
}

complete -F _apso_completion apso
`;

    this.log(script);
  }

  private generateZshCompletion(commands: string[]): void {
    const script = `#compdef apso

_apso() {
  local context state line
  typeset -A opt_args

  _arguments \\
    '1: :->command' \\
    '*: :->args'

  case $state in
    command)
      _describe 'commands' commands
      ;;
    args)
      case $words[1] in
        link|list|pull|push|sync|status|diff|queue|doctor|tui)
          # No additional completions for these commands
          ;;
        *)
          _describe 'commands' commands
          ;;
      esac
      ;;
  esac
}

commands=(
${commands
  .map((cmd) => `  '${cmd}:${this.getCommandDescription(cmd)}'`)
  .join("\n")}
)

_apso "$@"
`;

    this.log(script);
  }

  private getCommandDescription(command: string): string {
    const descriptions: Record<string, string> = {
      link: "Link project to workspace/service",
      list: "List workspaces and services",
      login: "Authenticate with platform",
      logout: "Log out from platform",
      pull: "Pull schema from platform",
      push: "Push schema to platform",
      sync: "Sync schemas",
      status: "Show sync status",
      diff: "Show schema differences",
      queue: "Manage queued operations",
      doctor: "Run diagnostics",
      tui: "Launch interactive TUI",
      completion: "Generate completion scripts",
    };
    return descriptions[command] || command;
  }

  private async installCompletion(shell: "bash" | "zsh"): Promise<void> {
    const homeDir = os.homedir();
    let configFile: string;
    let completionScript: string;

    if (shell === "bash") {
      configFile = path.join(homeDir, ".bashrc");
      completionScript = path.join(homeDir, ".apso-completion.bash");
    } else {
      configFile = path.join(homeDir, ".zshrc");
      completionScript = path.join(homeDir, ".apso-completion.zsh");
    }

    // Generate completion script
    const commands = [
      "link",
      "list",
      "login",
      "logout",
      "pull",
      "push",
      "sync",
      "status",
      "diff",
      "queue",
      "doctor",
      "tui",
      "completion",
    ];

    const script =
      shell === "bash"
        ? this.generateBashCompletionScript(commands)
        : this.generateZshCompletionScript(commands);

    // Write completion script
    fs.writeFileSync(completionScript, script, "utf8");

    // Add source line to config file
    const sourceLine =
      shell === "bash" ? `source ${completionScript}` : `. ${completionScript}`;

    let configContent = "";
    if (fs.existsSync(configFile)) {
      configContent = fs.readFileSync(configFile, "utf8");
    }

    if (configContent.includes(sourceLine)) {
      this.log(`✓ Completion script already installed for ${shell}`);
      this.log(`  Config file: ${configFile}`);
      this.log(`  Completion script: ${completionScript}`);
    } else {
      configContent += `\n# Apso CLI completion\n${sourceLine}\n`;
      fs.writeFileSync(configFile, configContent, "utf8");
      this.log(`✓ Completion script installed for ${shell}`);
      this.log(`  Added to ${configFile}`);
      this.log(`  Completion script: ${completionScript}`);
      this.log("");
      this.log("Please restart your shell or run:");
      this.log(`  source ${configFile}`);
    }
  }

  private generateBashCompletionScript(commands: string[]): string {
    /* eslint-disable no-template-curly-in-string */
    return `# Apso CLI bash completion
_apso_completion() {
  local cur prev opts
  COMPREPLY=()
  cur="${"${COMP_WORDS[COMP_CWORD]}"}"
  prev="${"${COMP_WORDS[COMP_CWORD-1]}"}"
  
  opts="${commands.join(" ")}"
  
  if [[ ${"${COMP_CWORD}"} == 1 ]]; then
    COMPREPLY=( $(compgen -W "${"${opts}"}" -- ${"${cur}"}) )
    return 0
  fi
  
  case ${"${prev}"} in
    link|list|pull|push|sync|status|diff|queue|doctor|tui)
      COMPREPLY=( $(compgen -W "" -- ${"${cur}"}) )
      ;;
    *)
      COMPREPLY=( $(compgen -W "${"${opts}"}" -- ${"${cur}"}) )
      ;;
  esac
}

complete -F _apso_completion apso
`;
    /* eslint-enable no-template-curly-in-string */
  }

  private generateZshCompletionScript(commands: string[]): string {
    return `#compdef apso

_apso() {
  local context state line
  typeset -A opt_args

  _arguments \\
    '1: :->command' \\
    '*: :->args'

  case $state in
    command)
      _describe 'commands' commands
      ;;
    args)
      case $words[1] in
        link|list|pull|push|sync|status|diff|queue|doctor|tui)
          # No additional completions for these commands
          ;;
        *)
          _describe 'commands' commands
          ;;
      esac
      ;;
  esac
}

commands=(
${commands
  .map((cmd) => `  '${cmd}:${this.getCommandDescription(cmd)}'`)
  .join("\n")}
)

_apso "$@"
`;
    /* eslint-enable no-template-curly-in-string */
  }
}
