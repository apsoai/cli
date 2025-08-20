# GitHub Migration Guide

This guide helps you migrate from CodeCommit to GitHub integration in the APSO CLI.

## Overview

The APSO CLI now supports GitHub as a repository provider, offering enhanced features and better integration with the GitHub ecosystem. This guide will help you migrate your existing CodeCommit-based services to GitHub.

## Migration Steps

### 1. Connect to GitHub

First, authenticate with GitHub using the new authentication command:

```bash
apso github connect
```

This will open a browser window for OAuth authentication. After successful authentication, your GitHub credentials will be securely stored.

### 2. List Your GitHub Repositories

View your available GitHub repositories:

```bash
apso repo list
```

### 3. Migrate Existing Services

For each service currently using CodeCommit, you'll need to connect it to a GitHub repository:

```bash
# Connect an existing service to a GitHub repository
apso repo connect <service-name> <github-owner/repo-name>

# Or use the interactive mode to select from your repositories
apso repo connect <service-name> --interactive
```

### 4. Create New Repositories (Optional)

If you want to create new repositories for your services:

```bash
# Create a new GitHub repository
apso repo create <repo-name> --private --description "My service repository"

# Connect it to your service
apso repo connect <service-name> <repo-name>
```

### 5. Update Service Creation

When creating new services, you can now directly connect them to GitHub repositories:

```bash
# Create a service and connect it to an existing repository
apso service create <service-name> --github-repo <owner/repo>

# Create a service and a new repository
apso service create <service-name> --create-repo

# Interactive mode will prompt for repository options
apso service create <service-name>
```

## Configuration Changes

The configuration file (`~/.apso/config.yml`) will be updated to include GitHub integration:

```yaml
github:
  connected: true
  username: "your-github-username"
  token_encrypted: "..."
  token_expires: "2024-12-31T23:59:59Z"

services:
  my-service:
    repository:
      type: "github"
      url: "https://github.com/owner/repo.git"
      owner: "owner"
      name: "repo"
```

## Backward Compatibility

Existing CodeCommit configurations will continue to work. The CLI will automatically detect the repository type and use the appropriate integration.

## Troubleshooting

### Authentication Issues

If you encounter authentication issues:

```bash
# Re-authenticate with GitHub
apso github connect

# Check connection status
apso github status
```

### Repository Access Issues

If you can't access a repository:

1. Verify you have the necessary permissions on GitHub
2. Check that the repository name is correct
3. Ensure your GitHub token has the required scopes

### Rollback to CodeCommit

If you need to rollback to CodeCommit:

1. Disconnect GitHub: `apso github disconnect`
2. Your CodeCommit configurations remain unchanged

## Next Steps

After migration, you can take advantage of new features:

- Deploy services with GitHub integration: `apso service deploy <service-name>`
- View repository information during deployment
- Automatic repository detection for existing services

## Support

For issues with the migration process, please contact support or file an issue on our GitHub repository.