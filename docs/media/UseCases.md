# APSO CLI Use Cases: Defining Relationships

This document provides examples for configuring different types of relationships in your `.apsorc` file, focusing on ManyToMany scenarios, particularly when using TypeORM.

## ManyToMany Relationships

### 1. Standard ManyToMany (Default Naming)

For a simple ManyToMany relationship where you accept TypeORM's default naming conventions for the join table and foreign keys.

**Entities:** `User`, `Group`

**.apsorc Example:**

```json
{
  "version": 2,
  "rootFolder": "src",
  "entities": [
    { "name": "User", "fields": [{ "name": "email", "type": "text" }] },
    { "name": "Group", "fields": [{ "name": "name", "type": "text" }] }
  ],
  "relationships": [
    {
      "from": "User",
      "to": "Group",
      "type": "ManyToMany",
      "bi_directional": true
      // "to_name": "groups" // Optional: specific property name on User
    },
    {
      "from": "Group",
      "to": "User",
      "type": "ManyToMany",
      "bi_directional": true
      // "to_name": "users" // Optional: specific property name on Group
    }
  ]
}
```

*   **Result:** TypeORM generates a join table (e.g., `user_groups_group`) with default foreign key columns (e.g., `userId`, `groupId`). The `@JoinTable()` decorator is added automatically to one side (the "owning" side, determined by APSO's logic).
*   **Use When:** You don't need custom names or extra fields on the join table.

### 2. ManyToMany with Custom Join Table/Column Names

When you want to control the naming of the join table and its foreign key columns directly, without adding extra fields to the relationship itself.

**Entities:** `User`, `Group`
**Desired Naming:** Join table `user_groups_link`, FKs `user_fk_id`, `group_fk_id`

**.apsorc Example:**

```json
{
  "version": 2,
  "rootFolder": "src",
  "entities": [
    { "name": "User", "fields": [{ "name": "email", "type": "text" }] },
    { "name": "Group", "fields": [{ "name": "name", "type": "text" }] }
  ],
  "relationships": [
    {
      "from": "User",         // Owning Side Definition
      "to": "Group",
      "type": "ManyToMany",
      "bi_directional": true,
      "to_name": "groups",     // Property on User
      "joinTableName": "user_groups_link",
      "joinColumnName": "user_fk_id",
      "inverseJoinColumnName": "group_fk_id"
    },
    {
      "from": "Group",        // Inverse Side Definition
      "to": "User",
      "type": "ManyToMany",
      "bi_directional": true,
      "to_name": "users"      // Property on Group (No join table details here)
    }
  ]
}
```

*   **Result:** TypeORM generates the `@JoinTable` decorator on the owning side (`User` entity's `groups` property in this case) with the specified `name`, `joinColumn`, and `inverseJoinColumn` parameters.
*   **Use When:** You need specific database naming conventions for the join table or foreign keys, but don't need to store extra data about the relationship itself.
*   **Requires:** APSO parsing and template logic must support these `joinTableName`, `joinColumnName`, `inverseJoinColumnName` fields (as updated in previous steps).

### 3. ManyToMany with Additional Fields (Intermediate Entity)

This is the standard TypeORM pattern when you need to store extra information about the relationship itself (e.g., when a user joined a group, their role in that group).

**Entities:** `User`, `Group`
**Intermediate Entity:** `Membership` (with fields like `role`, `joinedAt`)

**.apsorc Example:**

```json
{
  "version": 2,
  "rootFolder": "src",
  "entities": [
    { "name": "User", "fields": [{ "name": "email", "type": "text" }] },
    { "name": "Group", "fields": [{ "name": "name", "type": "text" }] },
    {
      "name": "Membership",
      "fields": [
        { "name": "role", "type": "text", "default": "member" },
        { "name": "joinedAt", "type": "timestamptz" }
        // Foreign key fields (e.g., userId, groupId) are implied by relationships
      ],
      "created_at": true // Or false if joinedAt serves this purpose
    }
  ],
  "relationships": [
    // Link User to Membership (One User has Many Memberships)
    { "from": "User", "to": "Membership", "type": "OneToMany", "to_name": "memberships" },
    // Link Group to Membership (One Group has Many Memberships)
    { "from": "Group", "to": "Membership", "type": "OneToMany", "to_name": "memberships" },
    // Link Membership back to User (Many Memberships belong to One User)
    { "from": "Membership", "to": "User", "type": "ManyToOne", "to_name": "user" },
    // Link Membership back to Group (Many Memberships belong to One Group)
    { "from": "Membership", "to": "Group", "type": "ManyToOne", "to_name": "group" }
  ]
}
```

*   **Result:** Three entities (`User`, `Group`, `Membership`) are generated. `Membership` has `@ManyToOne` relations to `User` and `Group`, and `User`/`Group` have `@OneToMany` relations to `Membership`.
*   **Use When:** You need to store data specific to the relationship between the two entities.
*   **Querying:** To get a user's groups, you query `User` -> `memberships` -> `group`.

## Self-Referencing Relationships (e.g., Parent/Child)

When an entity has a relationship with itself, like a `Load` having parent and child `Load`s.

### 1. Self-Referencing with Additional Fields (Intermediate Entity)

If you need extra fields on the relationship link (e.g., relationship type, timestamp established).

**Entity:** `Load`
**Intermediate Entity:** `LoadRelationship` (with fields like `relationshipType`)

**.apsorc Example:**

```json
{
  "version": 2,
  "rootFolder": "src",
  "entities": [
    { "name": "Load", "fields": [{ "name": "weight", "type": "float" }] },
    {
      "name": "LoadRelationship",
      "fields": [
        { "name": "relationshipType", "type": "text", "nullable": true }
        // Foreign keys parentLoadId, childLoadId are implied
      ],
      "created_at": true
    }
  ],
  "relationships": [
    // From LoadRelationship back to the parent Load
    { "from": "LoadRelationship", "to": "Load", "type": "ManyToOne", "to_name": "parentLoad" },
    // From LoadRelationship back to the child Load
    { "from": "LoadRelationship", "to": "Load", "type": "ManyToOne", "to_name": "childLoad" },
    // From Load to the relationships where it acts as the parent
    { "from": "Load", "to": "LoadRelationship", "type": "OneToMany", "to_name": "childLinks" },
    // From Load to the relationships where it acts as the child
    { "from": "Load", "to": "LoadRelationship", "type": "OneToMany", "to_name": "parentLinks" }
  ]
}
```

*   **Result:** Generates `Load` and `LoadRelationship` entities with the appropriate `@ManyToOne` and `@OneToMany` decorators.
*   **Use When:** You need attributes on the hierarchical link itself.
*   **Querying:** To get children of a load: `Load` -> `childLinks` -> `childLoad`.

### 2. Self-Referencing with Custom Join Table/Column Names (Direct)

If you *don't* need extra fields on the link, but want specific names for the join table and foreign keys.

**Entity:** `Load`
**Desired Naming:** Join table `load_hierarchy`, FKs `parent_id`, `child_id`

**.apsorc Example:**

```json
{
  "version": 2,
  "rootFolder": "src",
  "entities": [
    { "name": "Load", "fields": [{ "name": "weight", "type": "float" }] }
  ],
  "relationships": [
    {
      "from": "Load",           // Owning Side (Parent -> Children perspective)
      "to": "Load",
      "type": "ManyToMany",
      "bi_directional": true,
      "to_name": "children",     // Property on Load to get children
      "joinTableName": "load_hierarchy",
      "joinColumnName": "parent_id",         // FK for the parent ('from' side)
      "inverseJoinColumnName": "child_id"   // FK for the child ('to' side)
    },
    {
      "from": "Load",           // Inverse Side (Child -> Parents perspective)
      "to": "Load",
      "type": "ManyToMany",
      "bi_directional": true,
      "to_name": "parents"      // Property on Load to get parents
                                // No join table details here
    }
  ]
}
```

*   **Result:** Generates a `Load` entity with `children: Load[]` and `parents: Load[]` properties. The `@JoinTable` decorator is added to the `children` property (assuming it's the owning side) with the custom naming.
*   **Use When:** You need specific naming for the self-referencing join table/columns, but no extra fields.
*   **Requires:** APSO parsing and template logic must support `joinTableName`, `joinColumnName`, `inverseJoinColumnName` (as updated previously). 