# Test Scenarios (Gherkin)

## Overview

This document contains Behavior-Driven Development (BDD) test scenarios using Gherkin syntax. These scenarios define the expected behavior of the CLI and serve as acceptance criteria for implementation.

**Total Scenarios:** 36
**Coverage:** Authentication, Workspace/Service Management, Schema Sync, Git Integration, Offline Mode, TUI Mode

---

## Feature: Authentication

```gherkin
Feature: CLI Authentication
  As a developer
 I want to authenticate with the Apso platform
  So that I can sync my local work with the cloud

  Background:
    Given the Apso CLI is installed
    And I have an Apso platform account

  @auth @smoke @P0
  Scenario: Successful login via browser OAuth
    Given I am not logged in
    When I run "apso login"
    Then the CLI should open my default browser
    And I should see the Apso platform login page
    When I complete the login in the browser
    Then the CLI should display "Successfully logged in as <email>"
    And my credentials should be stored in "~/.apso/credentials.json"

  @auth @P0
  Scenario: Check authentication status when logged in
    Given I am logged in as "matt@example.com"
    When I run "apso whoami"
    Then the CLI should display "Logged in as matt@example.com"
    And the CLI should display the token expiry time

  @auth @P0
  Scenario: Check authentication status when not logged in
    Given I am not logged in
    When I run "apso whoami"
    Then the CLI should display "Not logged in"
    And the CLI should suggest running "apso login"

  @auth @P1
  Scenario: Logout clears credentials
    Given I am logged in as "matt@example.com"
    When I run "apso logout"
    Then the CLI should display "Logged out successfully"
    And "~/.apso/credentials.json" should not contain tokens

  @auth @error @P1
  Scenario: Login when already logged in
    Given I am logged in as "matt@example.com"
    When I run "apso login"
    Then the CLI should display "Already logged in as matt@example.com"
    And the CLI should prompt "Continue to re-authenticate? [y/N]"

  @auth @error @P2
  Scenario: Token expired triggers re-authentication
    Given I am logged in with an expired token
    When I run "apso list workspaces"
    Then the CLI should attempt to refresh the token
    When the refresh fails
    Then the CLI should display "Session expired. Please log in again."
    And the CLI should prompt to run "apso login"
```

---

## Feature: Workspace and Service Management

```gherkin
Feature: Workspace and Service Management
  As a developer
  I want to view and manage my workspaces and services
  So that I can organize my projects

  Background:
    Given I am logged in as "matt@example.com"

  @workspace @smoke @P1
  Scenario: List workspaces
    Given I have workspaces named "personal" and "acme-corp"
    When I run "apso list workspaces"
    Then the CLI should display a table with columns "Name", "Type", "Role"
    And the table should include "personal" with type "Personal"
    And the table should include "acme-corp" with type "Company"

  @workspace @P2
  Scenario: Set default workspace
    Given I have workspaces named "personal" and "acme-corp"
    When I run "apso config set defaultWorkspace acme-corp"
    Then the CLI should display "Default workspace set to 'acme-corp'"
    And "~/.apso/config.json" should contain "defaultWorkspace": "acme-corp"

  @service @smoke @P1
  Scenario: List services in default workspace
    Given my default workspace is "acme-corp"
    And "acme-corp" has services "api-v1" and "auth-service"
    When I run "apso list services"
    Then the CLI should display services "api-v1" and "auth-service"
    And each service should show status, type, and last updated

  @service @P1
  Scenario: List services in specified workspace
    Given I have access to workspace "acme-corp"
    When I run "apso list services --workspace acme-corp"
    Then the CLI should list services from "acme-corp"

  @service @wizard @P1
  Scenario: Create new service with GitHub connection
    Given my default workspace is "acme-corp"
    And I have GitHub connected to the workspace
    When I run "apso create"
    Then the CLI should prompt "What would you like to create?"
    When I select "Service"
    Then the CLI should prompt "Service name:"
    When I enter "my-new-api"
    Then the CLI should prompt "Connect GitHub repository?"
    When I select "Connect existing repo"
    Then the CLI should list my GitHub repositories
    When I select "acme-corp/my-new-api"
    Then the CLI should create the service on the platform
    And the CLI should display "Service 'my-new-api' created"
    And the CLI should display "Connected to github.com/acme-corp/my-new-api"

  @service @P2
  Scenario: JSON output for scripting
    Given "acme-corp" has services "api-v1" and "auth-service"
    When I run "apso list services --json"
    Then the output should be valid JSON
    And the JSON should contain an array of service objects
```

---

## Feature: Schema Synchronization

```gherkin
Feature: Schema Synchronization
  As a developer
  I want to sync my local schema with the platform
  So that my work is backed up and shareable

  Background:
    Given I am logged in as "matt@example.com"
    And I am in a project directory

  @schema @smoke @P1
  Scenario: Link local project to existing service
    Given my project is not linked to any service
    And I have a service "api-v1" in workspace "acme-corp"
    When I run "apso link"
    Then the CLI should prompt "Select workspace:"
    When I select "acme-corp"
    Then the CLI should prompt "Select service:"
    When I select "api-v1"
    Then the CLI should create ".apso/link.json"
    And ".apso/link.json" should contain serviceSlug "api-v1"
    And the CLI should display "Linked to acme-corp/api-v1"

  @schema @smoke @P1
  Scenario: Pull schema from platform to local
    Given my project is linked to service "api-v1"
    And the platform has a schema with entities "User" and "Post"
    And I have no local ".apsorc" file
    When I run "apso pull"
    Then the CLI should fetch the schema from the platform
    And the CLI should create ".apsorc" with entities "User" and "Post"
    And the CLI should display "Schema pulled successfully"

  @schema @conflict @P1
  Scenario: Pull schema with conflict resolution
    Given my project is linked to service "api-v1"
    And my local ".apsorc" has entity "User" with 3 fields
    And the platform schema has entity "User" with 5 fields
    When I run "apso pull"
    Then the CLI should display "Conflict detected"
    And the CLI should show a diff of the changes
    And the CLI should prompt "[Use Local] [Use Remote] [Merge] [Cancel]"
    When I select "Use Remote"
    Then the CLI should overwrite ".apsorc" with the platform version
    And the CLI should display "Schema updated from platform"

  @schema @smoke @P1
  Scenario: Push local schema to platform
    Given my project is linked to service "api-v1"
    And my local ".apsorc" has a new entity "Comment"
    When I run "apso push"
    Then the CLI should upload the schema to the platform
    And the platform should validate the schema
    And the CLI should display "Schema pushed successfully"
    And the CLI should display "Platform is generating code..."

  @schema @git @P1
  Scenario: Push schema triggers code generation
    Given my project is linked to service "api-v1" with GitHub repo "acme/api-v1"
    And my local ".apsorc" has been modified
    When I run "apso push"
    Then the CLI should push the schema to the platform
    And the platform should generate code
    And the platform should push to "acme/api-v1" on GitHub
    And the CLI should display "Code pushed to GitHub"
    And the CLI should prompt "Run git pull to update local code? [Y/n]"

  @schema @P2
  Scenario: View schema diff without syncing
    Given my project is linked to service "api-v1"
    And my local ".apsorc" differs from the platform
    When I run "apso diff"
    Then the CLI should display side-by-side comparison
    And added fields should be highlighted in green
    And removed fields should be highlighted in red
    And modified fields should be highlighted in yellow

  @schema @error @P1
  Scenario: Push schema validation failure
    Given my project is linked to service "api-v1"
    And my local ".apsorc" has invalid field types
    When I run "apso push"
    Then the platform should return validation errors
    And the CLI should display "Schema validation failed:"
    And the CLI should list each validation error
    And the schema should not be saved on the platform
```

---

## Feature: Git Integration

```gherkin
Feature: Git Integration
  As a developer
  I want the CLI to integrate with Git and GitHub
  So that my code stays in sync with platform changes

  Background:
    Given I am logged in as "matt@example.com"
    And I am in a Git repository

  @git @smoke @P1
  Scenario: Full sync workflow
    Given my project is linked to service "api-v1"
    And the service is connected to GitHub repo "acme/api-v1"
    And my local ".apsorc" has changes
    When I run "apso sync"
    Then the CLI should push the schema to the platform
    And the CLI should display "Schema synced to platform"
    And the CLI should display "Waiting for code generation..."
    And the CLI should poll until generation is complete
    And the CLI should display "Code pushed to GitHub"
    And the CLI should run "git pull"
    And the CLI should display "Local code updated"

  @git @P2
  Scenario: Sync with uncommitted local changes
    Given my project is linked to service "api-v1"
    And I have uncommitted changes in my working directory
    When I run "apso sync"
    Then the CLI should display "Warning: You have uncommitted changes"
    And the CLI should list the uncommitted files
    And the CLI should prompt "Stash changes and continue? [y/N]"
    When I select "y"
    Then the CLI should run "git stash"
    And the CLI should proceed with sync
    And after sync the CLI should prompt "Pop stashed changes? [Y/n]"

  @git @P2
  Scenario: Connect GitHub to workspace
    Given I am in workspace "acme-corp"
    And GitHub is not connected to the workspace
    When I run "apso connect github"
    Then the CLI should open the browser for GitHub OAuth
    When I authorize the Apso GitHub App
    Then the CLI should display "GitHub connected to acme-corp"
    And the workspace should have GitHub access

  @git @P2
  Scenario: List available GitHub repositories
    Given GitHub is connected to workspace "acme-corp"
    When I run "apso repos"
    Then the CLI should list repositories I have access to
    And each repo should show name, visibility, and last updated

  @git @error @P2
  Scenario: Sync when GitHub connection is broken
    Given my project is linked to service "api-v1"
    And the GitHub OAuth token has been revoked
    When I run "apso sync"
    Then the CLI should display "GitHub connection error"
    And the CLI should suggest "Run 'apso connect github' to reconnect"
```

---

## Feature: Offline Mode

```gherkin
Feature: Offline Mode
  As a developer
  I want to work offline
  So that I can continue development without internet

  Background:
    Given I am logged in as "matt@example.com"
    And my project is linked to service "api-v1"

  @offline @smoke @P1
  Scenario: Scaffold works offline
    Given I have no network connection
    And I have a valid local ".apsorc"
    When I run "apso scaffold"
    Then the CLI should generate code from ".apsorc"
    And the CLI should not attempt any network calls
    And the CLI should display "Code generated successfully"

  @offline @P2
  Scenario: Push queued when offline
    Given I have no network connection
    When I run "apso push"
    Then the CLI should display "No network connection"
    And the CLI should prompt "Queue this push for later? [Y/n]"
    When I select "y"
    Then the operation should be saved to ".apso/sync-queue.json"
    And the CLI should display "Push queued. Will sync when online."

  @offline @P2
  Scenario: Sync queue processed on reconnect
    Given I have queued operations in ".apso/sync-queue.json"
    And I now have network connection
    When I run "apso sync"
    Then the CLI should display "Processing 2 queued operations..."
    And the CLI should process each operation in order
    And successful operations should be removed from the queue
    And the CLI should display "Queue processed. All synced."

  @offline @P2
  Scenario: View cached workspace data offline
    Given I have cached workspace data
    And I have no network connection
    When I run "apso list workspaces"
    Then the CLI should display "(offline - showing cached data)"
    And the CLI should show workspaces from cache
    And the CLI should display "Last synced: <timestamp>"

  @offline @tui @P3
  Scenario: TUI shows offline indicator
    Given I have no network connection
    When I run "apso"
    Then the TUI should display "OFFLINE" indicator
    And the TUI should show cached data
    And mutation operations should show "queued for sync" badge

  @offline @error @P2
  Scenario: Operation requires network and no cache
    Given I have no network connection
    And I have no cached data
    When I run "apso list workspaces"
    Then the CLI should display "No network connection and no cached data"
    And the CLI should suggest "Connect to the internet to fetch workspace data"
```

---

## Feature: SDK Generation

```gherkin
Feature: Client SDK Generation
  As a frontend developer
  I want to generate a type-safe SDK from my service's API
  So that I have autocomplete and type checking when calling the API

  Background:
    Given I am logged in as "matt@example.com"
    And I have a deployed service "api-v1" in workspace "acme-corp"

  @sdk @smoke @P1
  Scenario: Generate SDK for linked service
    Given my project is linked to service "api-v1"
    And the service has an accessible OpenAPI endpoint
    When I run "apso sdk --output ./src/api"
    Then the CLI should fetch the OpenAPI specification
    And the CLI should generate TypeScript files in "./src/api"
    And the generated files should include "types.ts"
    And the generated files should include "client.ts"
    And the CLI should display "SDK generated successfully"

  @sdk @P1
  Scenario: Generate SDK for specific service
    Given the service "api-v1" is deployed
    When I run "apso sdk --service api-v1 --output ./src/api"
    Then the CLI should fetch OpenAPI from "api-v1"
    And the CLI should generate the SDK
    And the types should match the API schemas

  @sdk @P2
  Scenario: SDK watch mode detects changes
    Given I have generated an SDK for "api-v1"
    When I run "apso sdk --watch --output ./src/api"
    And the OpenAPI spec changes on the server
    Then the CLI should detect the change
    And the CLI should display "Spec changed! Regenerating..."
    And the CLI should regenerate the SDK
    And the CLI should display what changed

  @sdk @P2
  Scenario: Generated SDK compiles without errors
    Given I have a TypeScript project
    When I run "apso sdk --output ./src/api"
    And I run "npx tsc --noEmit"
    Then TypeScript should compile without errors

  @sdk @P2
  Scenario: Generated client has typed methods
    Given I generate an SDK for a service with "users" and "posts" endpoints
    Then the generated client should have a "users" property
    And "users" should have methods "list", "get", "create", "update", "delete"
    And each method should have typed parameters and return types

  @sdk @error @P2
  Scenario: SDK generation fails when service not deployed
    Given the service "api-v1" is not deployed
    When I run "apso sdk --service api-v1 --output ./src/api"
    Then the CLI should display "Service 'api-v1' is not deployed"
    And the CLI should suggest "Deploy the service first or use a deployed service"
```

---

## Feature: TUI Mode

```gherkin
Feature: TUI Interactive Mode
  As a developer
  I want an interactive terminal UI
  So that I can explore and manage my projects visually

  Background:
    Given I am logged in as "matt@example.com"

  @tui @smoke @P3
  Scenario: Launch TUI mode
    When I run "apso"
    Then the CLI should enter full-screen TUI mode
    And I should see a sidebar with "Workspaces" selected
    And I should see my workspaces listed
    And I should see keyboard shortcuts at the bottom

  @tui @P3
  Scenario: Navigate workspaces and services
    Given I am in TUI mode
    And I can see my workspaces
    When I press arrow keys to select "acme-corp"
    And I press Enter
    Then I should see services in "acme-corp"
    When I select service "api-v1"
    Then I should see service details panel
    And I should see schema entities listed

  @tui @wizard @P3
  Scenario: Create service wizard
    Given I am in TUI mode
    And I have selected workspace "acme-corp"
    When I press "n" for new service
    Then I should see the "Create Service" wizard
    And the wizard should prompt "Service name:"
    When I type "new-api" and press Enter
    Then the wizard should prompt "Service type:"
    When I select "Lambda"
    Then the wizard should prompt "Connect GitHub repository?"
    When I select "acme/new-api"
    Then the wizard should display a summary
    When I confirm
    Then the service should be created
    And I should return to the services list

  @tui @wizard @P3
  Scenario: Design schema wizard
    Given I am in TUI mode
    And I have selected service "api-v1"
    When I press "e" for edit schema
    Then I should see the schema designer
    And I should see existing entities
    When I press "a" to add entity
    Then I should be prompted for entity name
    When I type "Comment" and press Enter
    Then "Comment" should appear in the entity list
    When I select "Comment" and press "f" for add field
    Then I should be guided through field creation

  @tui @P3
  Scenario: Real-time sync status
    Given I am in TUI mode
    And my project has pending changes
    Then I should see a "Changes pending" indicator
    When I press "s" to sync
    Then I should see sync progress
    And the indicator should update to "Synced"

  @tui @P3
  Scenario: Exit TUI mode
    Given I am in TUI mode
    When I press "q" or Ctrl+C
    Then I should exit TUI mode
    And return to the normal terminal
```

---

## Test Scenario Summary

| Feature | Scenarios | P0 | P1 | P2 | P3 |
|---------|-----------|----|----|----|----|
| Authentication | 6 | 3 | 2 | 1 | 0 |
| Workspace/Service | 6 | 0 | 4 | 2 | 0 |
| Schema Sync | 7 | 0 | 6 | 1 | 0 |
| Git Integration | 5 | 0 | 1 | 4 | 0 |
| Offline Mode | 6 | 1 | 0 | 4 | 1 |
| SDK Generation | 6 | 0 | 2 | 4 | 0 |
| TUI Mode | 6 | 0 | 0 | 0 | 6 |
| **Total** | **42** | **4** | **15** | **16** | **7** |

---

## Tag Reference

| Tag | Meaning |
|-----|---------|
| `@smoke` | Critical path test, run on every commit |
| `@P0` | Must work for MVP launch |
| `@P1` | Core functionality, high priority |
| `@P2` | Important but can follow MVP |
| `@P3` | Nice to have, lower priority |
| `@auth` | Authentication related |
| `@schema` | Schema sync related |
| `@git` | Git/GitHub integration |
| `@offline` | Offline mode functionality |
| `@sdk` | SDK generation functionality |
| `@tui` | TUI mode functionality |
| `@wizard` | Interactive wizard flow |
| `@error` | Error handling scenario |
| `@conflict` | Conflict resolution scenario |
