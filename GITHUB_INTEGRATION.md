---

# GitHub Integration Guide

The APSO CLI now supports **comprehensive GitHub integration**, allowing you to authenticate with GitHub, manage repositories, and connect them to your services directly from the command line.

---

## Overview

GitHub integration includes:

* **OAuth Authentication** — Secure device flow authentication with encrypted token storage
* **Repository Management** — List, create, connect, and manage GitHub repositories
* **Service Integration** — Connect repositories to services for deployment and management
* **Security** — Encrypted token storage with OS keychain integration

---

## Quick Start

1. **Authenticate with GitHub:**

   ```bash
   apso github connect
   ```

2. **List your repositories:**

   ```bash
   apso repo list
   ```

3. **Create a new service with GitHub integration:**

   ```bash
   apso server new --name my-service --create-repo
   ```

---

## Commands Reference

### GitHub Authentication

#### `apso github connect`

Connect to GitHub using OAuth device flow or a personal access token.

**Options:**

* `--no-browser` — Don’t open the browser automatically
* `--token <token>` — Use a personal access token instead of OAuth

**Examples:**

```bash
apso github connect                     # OAuth with browser
apso github connect --no-browser        # OAuth without browser
apso github connect --token ghp_xxx     # Manual token
```

---

#### `apso github disconnect`

Disconnect from GitHub and remove stored credentials.

**Options:**

* `--force` — Skip confirmation prompt

**Examples:**

```bash
apso github disconnect
apso github disconnect --force
```

---

#### `apso github status`

Show GitHub connection status and information.

**Options:**

* `--detailed` — Show detailed information, including rate limits

**Examples:**

```bash
apso github status
apso github status --detailed
```

---

### Repository Management

#### `apso repo list`

List your GitHub repositories with filtering and formatting options.

**Options:**

* `--filter <type>` — Filter by visibility (`all`, `public`, `private`)
* `--sort <field>` — Sort by field (`name`, `updated`, `created`)
* `--output <format>` — Output format (`table`, `json`, `yaml`)
* `--page <num>` — Page number for pagination
* `--per-page <num>` — Items per page (1–100)

**Examples:**

```bash
apso repo list                          # Default table view
apso repo list --filter private         # Private repositories only
apso repo list --sort name              # Sort alphabetically
apso repo list --output json            # JSON output
apso repo list --page 2 --per-page 50   # Pagination
```

---

#### `apso repo create <name>`

Create a new GitHub repository.

**Options:**

* `--private` — Create a private repository
* `--description <desc>` — Repository description
* `--init` — Initialize with README
* `--service <name>` — Auto-connect to a service

**Examples:**

```bash
apso repo create my-api                                 # Public repo
apso repo create my-service --private                   # Private repo
apso repo create frontend --description "Frontend app"  # With description
apso repo create backend --init --service my-backend    # With README + service connection
```

---

#### `apso repo connect <service> [repository]`

Connect a GitHub repository to a service.

**Options:**

* `--interactive` — Interactive repository selection
* `--branch <name>` — Repository branch (default: `main`)
* `--force` — Overwrite existing connection

**Examples:**

```bash
apso repo connect my-service owner/repo                     # Connect by name
apso repo connect my-service https://github.com/owner/repo  # Connect by URL
apso repo connect my-service --interactive                  # Interactive selection
apso repo connect my-service owner/repo --branch develop    # Specific branch
```

---

#### `apso repo disconnect <service>`

Disconnect a repository from a service.

**Options:**

* `--force` — Skip confirmation prompt

**Examples:**

```bash
apso repo disconnect my-service
apso repo disconnect my-service --force
```

---

### Enhanced Service Commands

#### `apso server new`

Create a new server project with optional GitHub integration.

**New GitHub Options:**

* `--create-repo` — Create a new GitHub repository
* `--github-repo <url>` — Connect to an existing repository

**Examples:**

```bash
apso server new --name my-api --create-repo                 # Create with new repo
apso server new --name my-service --github-repo owner/repo  # Connect to existing
```

---

## Configuration

### Configuration File Location

Configuration is stored in `~/.apso/config.yml`:

```yaml
github:
  connected: true
  username: "your-username"
  token_encrypted: "encrypted-token-data"
  token_expires: "2024-12-31T23:59:59Z"

services:
  my-service:
    repository:
      type: "github"
      url: "https://github.com/owner/repo.git"
      owner: "owner"
      name: "repo"
      branch: "main"
```

---

### Token Security

* **Encryption**: Tokens are encrypted using AES-256-GCM
* **Key Storage**: Keys stored securely in `~/.apso/.key`
* **No Plain Text**: Tokens are never stored in plain text
* **Auto-Refresh**: Expired tokens trigger re-authentication

### OS Keychain Integration

When available, the CLI stores tokens in the OS keychain:

* **macOS**: Keychain Access
* **Windows**: Credential Manager
* **Linux**: Secret Service API (libsecret)
* **Fallback**: Encrypted file storage

---

## Output Formats

### Table (Default)

```
NAME                 VISIBILITY  UPDATED       CONNECTED
────────────────────────────────────────────────────────
my-api-service       private     2 hours ago   ✓ api-service
frontend-app         public      1 day ago     
data-processor       private     3 days ago    ✓ processor
```

### JSON

```json
[
  {
    "name": "my-api-service",
    "full_name": "owner/my-api-service",
    "private": true,
    "html_url": "https://github.com/owner/my-api-service",
    "connected": true,
    "service": "api-service"
  }
]
```

### YAML

```yaml
- name: my-api-service
  full_name: owner/my-api-service
  private: true
  html_url: https://github.com/owner/my-api-service
  connected: true
  service: api-service
```

---

## Interactive Features

### Repository Selection

With `--interactive`, the CLI provides:

* Arrow navigation
* Search/filter repositories
* Repository details (description, visibility, update time)
* Multi-select (where applicable)

### OAuth Flow

1. Request device code from GitHub
2. Open browser to authorization page
3. Show user code (for manual entry if needed)
4. Poll GitHub until authorized
5. Store encrypted token securely

---

## Error Handling

### Common Errors

**Authentication Error:**

```
GitHub API error (401) - Please check your GitHub authentication
```

*Solution:* Run `apso github connect` to re-authenticate.

**Repository Not Found:**

```
GitHub API error (404) - Repository or resource not found
```

*Solution:* Verify repository name and access permissions.

**Rate Limiting:**

```
GitHub API error (403) - Rate limit exceeded
```

*Solution:* Wait for reset or authenticate to raise limit.

**Network Issues:**

```
Network error: request timeout
```

*Solution:* Check your internet connection.

---

### Troubleshooting

```bash
apso github status --detailed   # Check token status
apso github disconnect          # Clear invalid token
apso github connect             # Re-authenticate
```

```bash
apso repo list --filter all     # Check repositories you can access
```

```bash
ls -la ~/.apso/                 # Verify config directory
cat ~/.apso/config.yml          # View config (tokens are encrypted)
```

---

## Migration from CodeCommit

1. **Create GitHub Repository:**

   ```bash
   apso repo create my-existing-service --private
   ```

2. **Migrate Code:**

   ```bash
   git remote add github https://github.com/owner/my-existing-service.git
   git push github main
   ```

3. **Update Service Connection:**

   ```bash
   apso repo disconnect my-existing-service
   apso repo connect my-existing-service owner/my-existing-service
   ```

---

## API Integration

* **GitHub REST API v3** — repository and user management
* **GitHub OAuth Device Flow** — secure authentication
* **GitHub Apps** — org-level integrations *(upcoming)*

### Rate Limits

* **Authenticated:** 5,000 requests/hour
* **Unauthenticated:** 60 requests/hour
* **Search API:** 30 requests/minute

Check with:

```bash
apso github status --detailed
```

---

## Best Practices

**Security**

* Prefer OAuth flow over PATs
* Run `apso github status` regularly
* Never share config files with encrypted tokens

**Repository Management**

* Use descriptive repo names and descriptions
* Keep service connections up to date
* Use private repos for sensitive services

**CLI Usage**

* Use `--output json` for scripting/automation
* Use interactive mode for exploration
* Use pagination for large repo lists

---

## Contributing

1. **Setup Development Environment**

   ```bash
   npm install
   npm run build
   ```

2. **Run Tests**

   ```bash
   npm test
   npm run test:cov
   ```

3. **Build and Test CLI**

   ```bash
   npm run build
   ./bin/run github status
   ```

---

## Support

1. Check troubleshooting guide above
2. Verify GitHub API status: [https://www.githubstatus.com/](https://www.githubstatus.com/)
3. Open an issue in the CLI repository
4. Contact the APSO team

---

## Changelog

### v0.1.0 — GitHub Integration Release

* ✅ OAuth device flow authentication
* ✅ Repository management commands
* ✅ Service integration
* ✅ Encrypted token storage
* ✅ Multiple output formats
* ✅ Interactive repository selection
* ✅ Enhanced server creation with GitHub options

### Upcoming

* GitHub Actions integration
* Organization repo management
* GitHub Apps support
* Team & permission management
* Advanced deployment workflows

---

✨ This version is clean, consistent, and reads like professional CLI documentation.

Do you want me to also create a **shortened version** (like a one-page quick reference) for onboarding developers, or do you prefer keeping this as the full detailed guide?
