# Apso CLI - Interactive TUI Mode

## Overview

The TUI (Terminal User Interface) provides an interactive, full-screen interface for browsing and managing Apso workspaces, services, and schemas without leaving the terminal.

## Problem It Solves

**Context Switching**: Developers often need to switch between terminal and browser to:
- Check which workspaces they have access to
- Browse services in a workspace
- View schema definitions (entities, fields, relationships)
- Understand service status and metadata

The TUI eliminates this friction by bringing platform exploration directly into the terminal.

## Use Cases

### 1. Quick Schema Reference
> "I'm writing code and need to check the field types for the User entity"

```bash
apso tui
# Navigate to workspace → service → view schema
```

### 2. Service Discovery
> "Which services exist in this workspace and what's their status?"

```bash
apso tui
# Browse services, see status, GitHub repo, etc.
```

### 3. New Developer Onboarding
> "I just joined the team - what services do we have?"

```bash
apso tui
# Explore all workspaces and services visually
```

### 4. Schema Design Review
> "I need to review entity relationships before making changes"

```bash
apso tui
# Navigate to service, view all entities and their relationships
```

## Prerequisites

1. **Authentication**: You must be logged in first
   ```bash
   apso login
   ```

2. **Network**: TUI requires network access to fetch data from the platform

## Usage

### Launch TUI
```bash
apso tui
```

### Keyboard Navigation

| Key | Action |
|-----|--------|
| `↑` / `↓` | Navigate up/down in lists |
| `Enter` | Select item / drill down |
| `Esc` / `Backspace` | Go back to previous view |
| `q` | Quit TUI |

### Views

#### 1. Workspace Browser
- Lists all workspaces you have access to
- Shows workspace name and slug
- Press Enter to view services in workspace

#### 2. Service Browser
- Lists all services in selected workspace
- Shows service name, status, and GitHub repo
- Press Enter to view schema

#### 3. Schema Viewer
- Split view: entities on left, details on right
- Navigate entities with arrow keys
- Shows fields with types and constraints (PK, NN, UQ)
- Shows relationships with target entities

## Status Bar

The bottom status bar shows:
- **Loading state**: Spinner when fetching data
- **Error state**: Red message if something failed
- **Ready state**: Green checkmark when ready
- **Keyboard hints**: Current available actions

## Architecture

```
src/tui/
├── index.tsx          # Entry point, render function
├── App.tsx            # Main app with state management
├── components/
│   ├── Layout.tsx     # Header + content layout
│   ├── StatusBar.tsx  # Bottom status bar
│   └── SelectList.tsx # Reusable keyboard-nav list
└── views/
    ├── WorkspaceBrowser.tsx  # Workspace list
    ├── ServiceBrowser.tsx    # Service list
    └── SchemaViewer.tsx      # Entity/field viewer
```

## Testing

### Manual Testing

1. **Setup**: Ensure you're logged in
   ```bash
   apso login
   apso whoami  # Verify authentication
   ```

2. **Launch TUI**
   ```bash
   apso tui
   ```

3. **Test Scenarios**:

   | Scenario | Steps | Expected |
   |----------|-------|----------|
   | Launch | Run `apso tui` | Full-screen UI appears |
   | Workspace list | Wait for load | See list of workspaces |
   | Navigate | Press ↓ | Selection moves down |
   | Select workspace | Press Enter | Services view appears |
   | Go back | Press Esc | Returns to workspaces |
   | View schema | Select service, Enter | Schema viewer appears |
   | Quit | Press q | Returns to terminal |

4. **Error Scenarios**:

   | Scenario | Steps | Expected |
   |----------|-------|----------|
   | Not logged in | Run `apso tui` without login | Error message |
   | Network error | Disconnect network, refresh | Error in status bar |
   | Empty workspace | Select workspace with no services | "No services found" message |

### Automated Tests

```bash
npm test -- --grep "tui"
```

## Future Enhancements (Roadmap)

Per the [Phase 6 Roadmap](../discovery/07-ROADMAP.md):

- [ ] Create Service Wizard (press 'n')
- [ ] Schema Editor Wizard (press 'e')
- [ ] Sync Controls (press 's' to sync)
- [ ] Offline mode with cached data
- [ ] Real-time sync status indicator

## Troubleshooting

### TUI doesn't launch
- Verify authentication: `apso whoami`
- Check network connectivity
- Ensure terminal supports full-screen mode

### Can't navigate
- Click inside the terminal window to ensure focus
- Try a different terminal emulator if issues persist

### Data not loading
- Check the status bar for error messages
- Verify network connectivity
- Try `apso list workspaces` to test API access

## Related Documentation

- [Discovery Overview](../discovery/00-OVERVIEW.md)
- [Test Scenarios](../discovery/06-TEST-SCENARIOS.md)
- [Implementation Roadmap](../discovery/07-ROADMAP.md)
