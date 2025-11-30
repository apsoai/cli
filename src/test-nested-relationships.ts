import { getNestedRelationships } from "./lib/utils/relationships";
import { RelationshipMap } from "./lib/types";

// Test case based on the diff showing camelCase issues
const relationshipMap: RelationshipMap = {
  User: [
    {
      type: "ManyToOne",
      name: "Workspace",
    },
  ],
  Workspace: [
    {
      type: "OneToMany",
      name: "User",
    },
    {
      type: "OneToMany",
      name: "WorkspaceUser",
    },
  ],
  WorkspaceUser: [
    {
      type: "ManyToOne",
      name: "Workspace",
    },
    {
      type: "ManyToOne",
      name: "User",
    },
    {
      type: "OneToMany",
      name: "WorkspaceServiceUser",
    },
  ],
  WorkspaceServiceUser: [
    {
      type: "ManyToOne",
      name: "WorkspaceUser",
    },
    {
      type: "ManyToOne",
      name: "WorkspaceService",
    },
  ],
  WorkspaceService: [
    {
      type: "OneToMany",
      name: "WorkspaceServiceUser",
    },
    {
      type: "OneToMany",
      name: "WorkspaceServiceApiKey",
    },
  ],
  WorkspaceServiceApiKey: [
    {
      type: "ManyToOne",
      name: "WorkspaceService",
    },
  ],
};

// Run the test for User entity
console.log("Nested relationships for User:");
const userNestedRelationships = getNestedRelationships("User", relationshipMap);
userNestedRelationships.forEach((rel) => console.log(` - ${rel}`));

// Run test for CustomerCard entity (similar to what's shown in the diff)
// Create a CustomerCard example with the pattern seen in the diff
const customerCardRelationshipMap: RelationshipMap = {
  CustomerCard: [
    {
      type: "ManyToOne",
      name: "User",
    },
  ],
  User: [
    {
      type: "OneToMany",
      name: "Workspace",
    },
  ],
  Workspace: [
    {
      type: "OneToMany",
      name: "WorkspaceUser",
    },
    {
      type: "OneToMany",
      name: "WorkspaceService",
    },
  ],
  WorkspaceService: [
    {
      type: "OneToMany",
      name: "WorkspaceServiceApiKey",
    },
  ],
  WorkspaceServiceApiKey: [
    {
      type: "ManyToOne",
      name: "WorkspaceService",
    },
  ],
};

console.log("\nNested relationships for CustomerCard:");
const customerCardNestedRelationships = getNestedRelationships(
  "CustomerCard",
  customerCardRelationshipMap
);
customerCardNestedRelationships.forEach((rel) => console.log(` - ${rel}`));

// Expected to see properly camelCased names like:
// - workspace.workspaceUsers
// - workspace.workspaceUsers.workspaceServiceUsers
// - workspace.workspaceUsers.workspaceServiceUsers.workspaceService
// - workspace.workspaceUsers.workspaceServiceUsers.workspaceService.workspaceServiceApiKeys
