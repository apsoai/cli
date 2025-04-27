import { describe, test, expect } from "@jest/globals";
import { getRelationshipForTemplate } from "../../lib/utils/relationships/parse";
import { Relationship } from "../../lib/types";

describe("getRelationshipForTemplate deduplication", () => {
  test("should deduplicate ManyToMany relationships", () => {
    // Mock entity name
    const entityName = "CustomerCard";
    
    // Mock relationships - simulating bidirectional ManyToMany where 
    // both sides are added to the relationships array for the same entity
    const mockRelationships: Relationship[] = [
      // First ManyToMany relationship (non-join side)
      {
        name: "Subscription",
        type: "ManyToMany",
        referenceName: "subscriptions",
        biDirectional: true,
        join: false,
        inverseReferenceName: "customercards"
      },
      // Duplicate relationship (join side) - similar to what happens in bidirectional ManyToMany
      {
        name: "Subscription",
        type: "ManyToMany",
        referenceName: "subscriptions",
        biDirectional: true,
        join: true, // This has join=true, indicating it's the owning side with @JoinTable
        inverseReferenceName: "customercards"
      }
    ];
    
    // Run the function
    const result = getRelationshipForTemplate(entityName, mockRelationships);
    
    // Assertions
    
    // 1. Should only have one relationship
    expect(result.length).toBe(1);
    
    // 2. The remaining relationship should be the one with join=true
    expect(result[0].name).toBe("Subscription");
    expect(result[0].joinTable).toBe(true);
  });

  test("should keep first relationship when reference names differ", () => {
    // Mock entity name
    const entityName = "User";
    
    // Create mocked relationships with same target but different reference names
    const mockRelationships: Relationship[] = [
      {
        name: "Workspace",
        type: "ManyToMany",
        referenceName: "workspaces",
        biDirectional: true,
        join: true
      },
      {
        name: "Workspace",
        type: "ManyToMany",
        referenceName: "ownedWorkspaces", // Different reference name
        biDirectional: true,
        join: true
      }
    ];
    
    // Run the function
    const result = getRelationshipForTemplate(entityName, mockRelationships);
    
    // Assertions
    
    // Current behavior: Only one relationship is kept during name-based deduplication (second phase)
    expect(result.length).toBe(1);
    
    // The first one is kept in the Set processing 
    expect(result[0].relationshipName).toBe("workspaces");
  });

  test("should prioritize owner side (join=true) when deduplicating", () => {
    // Scenario based on real issue: two ManyToMany relationships to same entity
    const entityName = "Tag";
    
    // Create relationships where one has join=true and one has join=false (non-owning side)
    const mockRelationships: Relationship[] = [
      {
        name: "WorkspaceService",
        type: "ManyToMany",
        biDirectional: true,
        join: false,
        referenceName: "workspaceservices"
      },
      {
        name: "WorkspaceService",
        type: "ManyToMany",
        biDirectional: true,
        join: true, // This one has join=true
        referenceName: "workspaceservices"
      }
    ];
    
    // Run the function
    const result = getRelationshipForTemplate(entityName, mockRelationships);
    
    // Assertions
    
    // Should only have one relationship
    expect(result.length).toBe(1);
    
    // Should be the one with join=true
    expect(result[0].name).toBe("WorkspaceService");
    expect(result[0].joinTable).toBe(true); // joinTable corresponds to join
  });
}); 