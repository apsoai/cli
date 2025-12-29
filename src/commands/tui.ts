import { Flags } from "@oclif/core";
import BaseCommand from "../lib/base-command";
import * as blessed from "blessed";
import {
  createApiClient,
  WorkspaceSummary,
  ServiceSummary,
} from "../lib/api/client";
import { readProjectLink } from "../lib/project-link";
import { getNetworkStatus, NetworkStatus } from "../lib/network";
import { LocalApsorcSchema } from "../lib/schema-converter/types";
import * as fs from "fs";
import { getAuthoritativeApsorcPath } from "../lib/project-link";
import { calculateSchemaHash } from "../lib/schema-hash";
import { detectConflict, ConflictType } from "../lib/conflict-detector";

/**
 * TUI Application State
 */
interface TUIState {
  workspaces: WorkspaceSummary[];
  services: ServiceSummary[];
  selectedWorkspace: WorkspaceSummary | null;
  selectedService: ServiceSummary | null;
  localSchema: LocalApsorcSchema | null;
  remoteSchema: LocalApsorcSchema | null;
  syncStatus: ConflictType | null;
}

export default class TUI extends BaseCommand {
  static description =
    "Launch interactive TUI for exploring workspaces, services, and schemas";

  static examples = ["$ apso tui", "$ apso tui --workspace-id <id>"];

  static flags = {
    "workspace-id": Flags.string({
      description: "Pre-select a workspace by ID",
    }),
  };

  private screen!: blessed.Widgets.Screen;
  private sidebar!: blessed.Widgets.ListElement;
  private mainContent!: blessed.Widgets.BoxElement;
  private helpBar!: blessed.Widgets.BoxElement;
  private state: TUIState = {
    workspaces: [],
    services: [],
    selectedWorkspace: null,
    selectedService: null,
    localSchema: null,
    remoteSchema: null,
    syncStatus: null,
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(TUI);

    // Ensure authentication
    await this.ensureAuthenticated({
      nonInteractive: false,
    });

    // Initialize TUI
    this.initializeTUI();

    // Load initial data
    await this.loadInitialData(flags["workspace-id"]);

    // Setup keyboard handlers
    this.setupKeyboardHandlers();

    // Render initial view
    this.render();

    // Focus sidebar and start the TUI
    // Use setTimeout to ensure focus happens after render
    setTimeout(() => {
      this.sidebar.focus();
      this.screen.render();
    }, 0);
  }

  private initializeTUI(): void {
    // Create screen
    this.screen = blessed.screen({
      smartCSR: true,
      title: "Apso CLI - TUI",
      fullUnicode: true,
      fastCSR: true,
      input: process.stdin,
      output: process.stdout,
      // Ensure terminal is in raw mode for proper keyboard handling
      terminal: "xterm-256color",
    });

    // Create sidebar (30% width)
    this.sidebar = blessed.list({
      top: 0,
      left: 0,
      width: "30%",
      height: "100%",
      keys: true,
      vi: true,
      mouse: true,
      style: {
        selected: {
          bg: "blue",
          fg: "white",
          bold: true,
        },
        item: {
          fg: "white",
        },
      },
      border: {
        type: "line",
      },
      label: " Navigation ",
      scrollable: true,
      alwaysScroll: true,
    });

    // Create main content area (70% width)
    this.mainContent = blessed.box({
      top: 0,
      left: "30%",
      width: "70%",
      height: "90%",
      content: "",
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      vi: true,
      style: {
        border: {
          fg: "white",
        },
      },
      border: {
        type: "line",
      },
      label: " Content ",
    });

    // Create help bar at bottom
    this.helpBar = blessed.box({
      top: "90%",
      left: "30%",
      width: "70%",
      height: "10%",
      content:
        " [Q]uit | [↑↓] Navigate | [Enter] Select | [R]efresh | [S]ync | [P]ush | [L] Pull ",
      style: {
        bg: "black",
        fg: "white",
      },
      border: {
        type: "line",
      },
    });

    // Append to screen
    this.screen.append(this.sidebar);
    this.screen.append(this.mainContent);
    this.screen.append(this.helpBar);

    // Focus sidebar by default
    this.sidebar.focus();
  }

  private async loadInitialData(
    preSelectedWorkspaceId?: string
  ): Promise<void> {
    try {
      const api = createApiClient();

      // Load workspaces
      this.log("Loading workspaces...");
      const workspaces = await api.listWorkspaces();
      this.state.workspaces = workspaces;

      // Pre-select workspace if provided
      if (preSelectedWorkspaceId) {
        const workspaceId = Number(preSelectedWorkspaceId);
        if (!Number.isNaN(workspaceId)) {
          const workspace = workspaces.find((w) => w.id === workspaceId);
          if (workspace) {
            this.state.selectedWorkspace = workspace;
            await this.loadServicesForWorkspace(workspace.id);
          }
        }
      }

      // Load local schema if project is linked
      const linkInfo = readProjectLink();
      if (linkInfo) {
        await this.loadLocalSchema();
      }

      // Update sidebar
      this.updateSidebar();
    } catch (error) {
      this.showError(`Failed to load data: ${(error as Error).message}`);
    }
  }

  private async loadServicesForWorkspace(workspaceId: number): Promise<void> {
    try {
      const api = createApiClient();
      const services = await api.listServices(workspaceId.toString());
      this.state.services = services;
      this.updateSidebar();
    } catch (error) {
      this.showError(`Failed to load services: ${(error as Error).message}`);
    }
  }

  private async loadLocalSchema(): Promise<void> {
    try {
      const apsorcPath = getAuthoritativeApsorcPath();
      if (fs.existsSync(apsorcPath)) {
        const rawContent = fs.readFileSync(apsorcPath);
        // eslint-disable-next-line unicorn/prefer-json-parse-buffer
        this.state.localSchema = JSON.parse(rawContent.toString("utf8")) as LocalApsorcSchema;
      }
    } catch (error) {
      // Schema loading failure is not critical
      if (process.env.DEBUG || process.env.APSO_DEBUG) {
        this.log(
          `[DEBUG] Failed to load local schema: ${(error as Error).message}`
        );
      }
    }
  }

  private updateSidebar(): void {
    const items: string[] = [];

    // Add workspaces section
    items.push("{bold}Workspaces{/bold}");
    if (this.state.workspaces.length === 0) {
      items.push("  (No workspaces)");
    } else {
      for (const workspace of this.state.workspaces) {
        const prefix =
          this.state.selectedWorkspace?.id === workspace.id ? "▶ " : "  ";
        items.push(`${prefix}${workspace.name} (${workspace.slug})`);
      }
    }

    // Add services section if workspace is selected
    if (this.state.selectedWorkspace) {
      items.push("");
      items.push("{bold}Services{/bold}");
      if (this.state.services.length === 0) {
        items.push("  (No services)");
      } else {
        for (const service of this.state.services) {
          const prefix =
            this.state.selectedService?.id === service.id ? "▶ " : "  ";
          items.push(`${prefix}${service.name} (${service.slug})`);
        }
      }
    }

    // Add local project section
    const linkInfo = readProjectLink();
    if (linkInfo) {
      items.push("");
      items.push("{bold}Local Project{/bold}");
      items.push(`  Workspace: ${linkInfo.link.workspaceSlug}`);
      items.push(`  Service: ${linkInfo.link.serviceSlug}`);
      if (this.state.localSchema) {
        items.push(
          `  Schema: ${this.state.localSchema.entities?.length || 0} entities`
        );
      }
    }

    // Store current selection before updating
    const currentSelected = (this.sidebar as any).selected || 0;

    this.sidebar.setItems(items);

    // Restore selection if possible, otherwise select first selectable item
    const firstSelectableIndex = this.findFirstSelectableIndex(items);
    if (
      currentSelected < items.length &&
      this.isSelectableItem(items[currentSelected])
    ) {
      (this.sidebar as any).select(currentSelected);
    } else if (firstSelectableIndex >= 0) {
      (this.sidebar as any).select(firstSelectableIndex);
    }

    // Ensure sidebar maintains focus after updating items
    if (!(this.mainContent as any).focused) {
      this.sidebar.focus();
    }

    this.screen.render();
  }

  private findFirstSelectableIndex(items: string[]): number {
    for (const [i, item] of items.entries()) {
      if (this.isSelectableItem(item)) {
        return i;
      }
    }
    return -1;
  }

  private isSelectableItem(item: string): boolean {
    // Headers and empty lines are not selectable
    if (!item || item.trim() === "" || item.includes("{bold}")) {
      return false;
    }
    // Items starting with "  " or "▶ " are selectable
    return item.startsWith("  ") || item.startsWith("▶ ");
  }

  private updateMainContent(): void {
    const selectedIndex = (this.sidebar as any).selected || 0;
    const items = (this.sidebar as any).items || [];
    const selectedItem = items[selectedIndex]?.content?.toString() || "";

    let content = "";

    // Determine what to show based on selection
    if (
      selectedItem.includes("Workspaces") ||
      selectedItem.includes("(No workspaces)")
    ) {
      content = this.renderWorkspacesView();
    } else if (
      selectedItem.includes("Services") ||
      selectedItem.includes("(No services)")
    ) {
      content = this.renderServicesView();
    } else if (selectedItem.includes("Local Project")) {
      content = this.renderLocalProjectView();
    } else if (selectedItem.startsWith("▶") || selectedItem.startsWith("  ")) {
      // Check if it's a workspace
      const workspaceName = selectedItem.replace(/^[ ▶]+/, "").split(" (")[0];
      const workspace = this.state.workspaces.find(
        (w) => w.name === workspaceName
      );
      if (workspace) {
        content = this.renderWorkspaceDetails(workspace);
      } else {
        // Check if it's a service
        const serviceName = selectedItem.replace(/^[ ▶]+/, "").split(" (")[0];
        const service = this.state.services.find((s) => s.name === serviceName);
        if (service) {
          content = this.renderServiceDetails(service);
        }
      }
    } else {
      content = this.renderWelcomeView();
    }

    this.mainContent.setContent(content);
    this.screen.render();
  }

  private renderWelcomeView(): string {
    return `
{bold}Welcome to Apso CLI TUI{/bold}

Use the sidebar to navigate:
  • Workspaces - Browse available workspaces
  • Services - View services in selected workspace
  • Local Project - View linked project details

Keyboard Shortcuts:
  [Q]uit - Exit TUI
  [↑↓] - Navigate sidebar
  [Enter] - Select item
  [R]efresh - Reload data
  [S]ync - Sync schemas
  [P]ush - Push local schema
  [L] Pull - Pull remote schema

Network Status: ${
      getNetworkStatus() === NetworkStatus.OFFLINE
        ? "{red-fg}Offline{/red-fg}"
        : "{green-fg}Online{/green-fg}"
    }
`;
  }

  private renderWorkspacesView(): string {
    let content = "{bold}Workspaces{/bold}\n\n";

    if (this.state.workspaces.length === 0) {
      content += "No workspaces found.\n";
      content += "Press [R] to refresh or check your authentication.";
    } else {
      for (const workspace of this.state.workspaces) {
        const isSelected = this.state.selectedWorkspace?.id === workspace.id;
        const prefix = isSelected ? "▶ " : "  ";
        content += `${prefix}{${isSelected ? "bold" : ""}}${workspace.name}{/${
          isSelected ? "bold" : ""
        }} (${workspace.slug})\n`;
        content += `    ID: ${workspace.id}\n`;
        content += "\n";
      }
    }

    return content;
  }

  private renderWorkspaceDetails(workspace: WorkspaceSummary): string {
    let content = `{bold}Workspace: ${workspace.name}{/bold}\n\n`;
    content += `Slug: ${workspace.slug}\n`;
    content += `ID: ${workspace.id}\n`;
    content += `\n{bold}Services: ${this.state.services.length}{/bold}\n\n`;

    if (this.state.services.length === 0) {
      content += "No services in this workspace.\n";
    } else {
      for (const service of this.state.services) {
        content += `  • ${service.name} (${service.slug})\n`;
      }
    }

    return content;
  }

  private renderServicesView(): string {
    let content = "{bold}Services{/bold}\n\n";

    if (!this.state.selectedWorkspace) {
      content += "Select a workspace first to view services.\n";
    } else if (this.state.services.length === 0) {
      content += "No services found in this workspace.\n";
      content += "Press [R] to refresh.";
    } else {
      for (const service of this.state.services) {
        const isSelected = this.state.selectedService?.id === service.id;
        const prefix = isSelected ? "▶ " : "  ";
        content += `${prefix}{${isSelected ? "bold" : ""}}${service.name}{/${
          isSelected ? "bold" : ""
        }} (${service.slug})\n`;
        content += `    ID: ${service.id}\n`;
        content += "\n";
      }
    }

    return content;
  }

  private renderServiceDetails(service: ServiceSummary): string {
    let content = `{bold}Service: ${service.name}{/bold}\n\n`;
    content += `Slug: ${service.slug}\n`;
    content += `ID: ${service.id}\n`;
    content += `\n{bold}Workspace:{/bold} ${
      this.state.selectedWorkspace?.name || "Unknown"
    }\n`;

    // Show sync status if project is linked to this service
    const linkInfo = readProjectLink();
    if (linkInfo && Number(linkInfo.link.serviceId) === service.id) {
      content += `\n{bold}Local Project:{/bold} Linked\n`;
      if (this.state.localSchema) {
        const entityCount = this.state.localSchema.entities?.length || 0;
        content += `  Entities: ${entityCount}\n`;
        const localHash = calculateSchemaHash(this.state.localSchema);
        content += `  Local Hash: ${localHash.slice(0, 8)}...\n`;
      }
    }

    return content;
  }

  private renderLocalProjectView(): string {
    const linkInfo = readProjectLink();
    if (!linkInfo) {
      return "{bold}Local Project{/bold}\n\nProject is not linked.\nRun 'apso link' to link this project to a service.";
    }

    let content = `{bold}Local Project{/bold}\n\n`;
    content += `Workspace: ${linkInfo.link.workspaceSlug} (${linkInfo.link.workspaceId})\n`;
    content += `Service: ${linkInfo.link.serviceSlug} (${linkInfo.link.serviceId})\n`;
    content += `Linked At: ${new Date(
      linkInfo.link.linkedAt
    ).toLocaleString()}\n`;

    if (linkInfo.link.lastSyncedAt) {
      content += `Last Synced: ${new Date(
        linkInfo.link.lastSyncedAt
      ).toLocaleString()}\n`;
      content += `Sync Direction: ${
        linkInfo.link.lastSyncDirection || "unknown"
      }\n`;
    }

    if (this.state.localSchema) {
      content += `\n{bold}Local Schema{/bold}\n`;
      content += `  Entities: ${
        this.state.localSchema.entities?.length || 0
      }\n`;
      content += `  Relationships: ${
        this.state.localSchema.relationships?.length || 0
      }\n`;
      const localHash = calculateSchemaHash(this.state.localSchema);
      content += `  Hash: ${localHash.slice(0, 16)}...\n`;
    } else {
      content += `\n{bold}Local Schema{/bold}\n`;
      content += `  No local schema found.\n`;
      content += `  Run 'apso pull' to fetch schema from platform.\n`;
    }

    if (linkInfo.link.remoteSchemaHash) {
      content += `\n{bold}Remote Schema{/bold}\n`;
      content += `  Hash: ${linkInfo.link.remoteSchemaHash.slice(
        0,
        16
      )}...\n`;
    }

    // Show sync status
    if (this.state.localSchema && linkInfo.link.remoteSchemaHash) {
      const localHash = calculateSchemaHash(this.state.localSchema);
      const conflict = detectConflict(
        localHash,
        linkInfo.link.remoteSchemaHash,
        this.state.localSchema
      );
      content += `\n{bold}Sync Status:{/bold} `;
      switch (conflict.type) {
        case ConflictType.NO_CONFLICT:
          content += `{green-fg}In Sync{/green-fg}\n`;
          break;
        case ConflictType.LOCAL_CHANGED:
          content += `{yellow-fg}Local Changed{/yellow-fg}\n`;
          break;
        case ConflictType.REMOTE_CHANGED:
          content += `{yellow-fg}Remote Changed{/yellow-fg}\n`;
          break;
        case ConflictType.DIVERGED:
          content += `{red-fg}Diverged{/red-fg}\n`;
          break;
        default:
          content += `Unknown\n`;
      }
    }

    return content;
  }

  private setupKeyboardHandlers(): void {
    // Quit on Q or Escape (only when sidebar is focused or globally)
    this.screen.key(["q", "Q", "escape", "C-c"], () => {
      return this.exit(0);
    });

    // Global keyboard shortcuts (work from anywhere)
    // Only handle these when sidebar is NOT focused to avoid conflicts
    this.screen.key(["r", "R"], async (_ch, _key) => {
      // Don't intercept if sidebar is handling it
      if ((this.sidebar as any).focused) {
        return;
      }
      this.sidebar.focus();
      await this.loadInitialData();
      this.updateMainContent();
    });

    this.screen.key(["s", "S"], async () => {
      if ((this.sidebar as any).focused) {
        return;
      }
      this.sidebar.focus();
      await this.handleSync();
    });

    this.screen.key(["p", "P"], async () => {
      if ((this.sidebar as any).focused) {
        return;
      }
      this.sidebar.focus();
      await this.handlePush();
    });

    this.screen.key(["l", "L"], async () => {
      if ((this.sidebar as any).focused) {
        return;
      }
      this.sidebar.focus();
      await this.handlePull();
    });

    // Sidebar selection handler - updates main content
    this.sidebar.on("select", () => {
      this.handleSidebarSelection();
    });

    // Handle arrow key navigation to skip non-selectable items (headers, empty lines)
    this.sidebar.on("keypress", (ch, key) => {
      if (key.name === "up" || key.name === "down") {
        const items = (this.sidebar as any).items || [];
        const currentIndex = (this.sidebar as any).selected || 0;
        const direction = key.name === "up" ? -1 : 1;
        let nextIndex = currentIndex + direction;

        // Skip non-selectable items (headers, empty lines)
        while (nextIndex >= 0 && nextIndex < items.length) {
          const item = items[nextIndex]?.content?.toString() || "";
          if (this.isSelectableItem(item)) {
            (this.sidebar as any).select(nextIndex);
            this.handleSidebarSelection();
            return;
          }
          nextIndex += direction;
        }

        // If we couldn't find a selectable item, stay at current position
        (this.sidebar as any).select(currentIndex);
      }
    });

    // Ensure sidebar gets focus when clicking or interacting
    this.sidebar.on("focus", () => {
      // Sidebar is focused, navigation will work
    });

    // When main content is focused, allow scrolling
    this.mainContent.key(["up", "down", "pageup", "pagedown"], () => {
      // Allow scrolling in main content
    });

    // Click on sidebar to focus it
    this.sidebar.on("click", () => {
      this.sidebar.focus();
    });

    // Tab key to switch focus between sidebar and main content
    this.screen.key(["tab"], () => {
      if ((this.sidebar as any).focused) {
        this.mainContent.focus();
      } else {
        this.sidebar.focus();
      }
    });

    // Don't let screen handle arrow keys - let sidebar handle them
    // Remove any screen-level arrow key handlers that might interfere
  }

  private handleSidebarSelection(): void {
    const selectedIndex = (this.sidebar as any).selected || 0;
    const items = (this.sidebar as any).items || [];
    const selectedItem = items[selectedIndex]?.content?.toString() || "";

    // Handle workspace selection
    if (selectedItem.startsWith("▶") || selectedItem.startsWith("  ")) {
      const itemName = selectedItem.replace(/^[ ▶]+/, "").split(" (")[0];

      // Check if it's a workspace
      const workspace = this.state.workspaces.find((w) => w.name === itemName);
      if (workspace && this.state.selectedWorkspace?.id !== workspace.id) {
        this.state.selectedWorkspace = workspace;
        this.state.selectedService = null;
        this.loadServicesForWorkspace(workspace.id);
      }

      // Check if it's a service
      const service = this.state.services.find((s) => s.name === itemName);
      if (service && this.state.selectedService?.id !== service.id) {
        this.state.selectedService = service;
      }
    }

    this.updateSidebar();
    this.updateMainContent();
  }

  private async handleSync(): Promise<void> {
    const linkInfo = readProjectLink();
    if (!linkInfo) {
      this.showError("Project is not linked. Run 'apso link' first.");
      return;
    }

    this.showMessage("Syncing schemas... (This would call 'apso sync')");
    // eslint-disable-next-line no-warning-comments
    // TODO: Actually call sync command
  }

  private async handlePush(): Promise<void> {
    const linkInfo = readProjectLink();
    if (!linkInfo) {
      this.showError("Project is not linked. Run 'apso link' first.");
      return;
    }

    this.showMessage("Pushing schema... (This would call 'apso push')");
    // eslint-disable-next-line no-warning-comments
    // TODO: Actually call push command
  }

  private async handlePull(): Promise<void> {
    const linkInfo = readProjectLink();
    if (!linkInfo) {
      this.showError("Project is not linked. Run 'apso link' first.");
      return;
    }

    this.showMessage("Pulling schema... (This would call 'apso pull')");
    // eslint-disable-next-line no-warning-comments
    // TODO: Actually call pull command
  }

  private showMessage(message: string): void {
    const msgBox = blessed.box({
      top: "center",
      left: "center",
      width: "50%",
      height: "shrink",
      content: message,
      border: {
        type: "line",
      },
      style: {
        bg: "blue",
        fg: "white",
      },
    });

    this.screen.append(msgBox);
    this.screen.render();

    setTimeout(() => {
      this.screen.remove(msgBox);
      this.screen.render();
    }, 2000);
  }

  private showError(message: string): void {
    const errorBox = blessed.box({
      top: "center",
      left: "center",
      width: "50%",
      height: "shrink",
      content: `{red-fg}Error:{/red-fg}\n\n${message}`,
      border: {
        type: "line",
      },
      style: {
        bg: "red",
        fg: "white",
      },
    });

    this.screen.append(errorBox);
    this.screen.render();

    // Remove on any key press
    const removeError = () => {
      this.screen.remove(errorBox);
      this.screen.render();
      this.screen.removeListener("keypress", removeError);
    };
    this.screen.on("keypress", removeError);
  }

  private render(): void {
    this.updateSidebar();
    this.updateMainContent();
  }
}
