import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { parseRelationships, getRelationshipForTemplate } from './parse';
import { ApsorcRelationship, RelationshipMap, Relationship } from '../../types';

describe('parseRelationships', () => {

  // Mock console.warn to prevent test output clutter
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => { /* No output */ });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('ManyToMany Relationships', () => {
    it('should parse a single bidirectional ManyToMany definition', () => {
      const relationships: ApsorcRelationship[] = [
        {
          from: 'EntityA',
          to: 'EntityB',
          type: 'ManyToMany',
          // eslint-disable-next-line camelcase
          bi_directional: true,
        },
      ];

      const expected: RelationshipMap = {
        EntityA: [
          {
            name: 'EntityB',
            type: 'ManyToMany',
            referenceName: 'EntityB', // PascalCase entity name
            join: true, // Owning side by default if no explicit details
            biDirectional: true,
            joinTableName: undefined,
            joinColumnName: undefined,
            inverseJoinColumnName: undefined,
            inverseReferenceName: 'EntityA', // PascalCase entity name
          },
        ],
        EntityB: [
          {
            name: 'EntityA',
            type: 'ManyToMany',
            referenceName: 'EntityA', // PascalCase entity name
            join: false, // Non-owning side
            biDirectional: true,
            joinTableName: undefined,
            joinColumnName: undefined,
            inverseJoinColumnName: undefined,
            inverseReferenceName: 'EntityB', // PascalCase entity name
          },
        ],
      };

      const result = parseRelationships(relationships);
      expect(result).toEqual(expected);
    });

    it('should parse a single bidirectional ManyToMany with to_name', () => {
      const relationships: ApsorcRelationship[] = [
        {
          from: 'User',
          to: 'Group',
          type: 'ManyToMany',
          // eslint-disable-next-line camelcase
          bi_directional: true,
          // eslint-disable-next-line camelcase
          to_name: 'userGroups',
        },
      ];

      const expected: RelationshipMap = {
        User: [
          {
            name: 'Group',
            type: 'ManyToMany',
            referenceName: 'userGroups', // Preserved from to_name
            join: true, // Owning side by default
            biDirectional: true,
            joinTableName: undefined,
            joinColumnName: undefined,
            inverseJoinColumnName: undefined,
            inverseReferenceName: 'User', // PascalCase entity name
          },
        ],
        Group: [
          {
            name: 'User',
            type: 'ManyToMany',
            referenceName: 'User', // PascalCase entity name
            join: false, // Non-owning side
            biDirectional: true,
            joinTableName: undefined,
            joinColumnName: undefined,
            inverseJoinColumnName: undefined,
            inverseReferenceName: 'userGroups', // Preserved camelCase from to_name
          },
        ],
      };

      const result = parseRelationships(relationships);
      expect(result).toEqual(expected);
    });

    it('should parse a unidirectional ManyToMany definition', () => {
      const relationships: ApsorcRelationship[] = [
        {
          from: 'Post',
          to: 'Tag',
          type: 'ManyToMany',
          // bi_directional is false or omitted
        },
      ];

      const expected: RelationshipMap = {
        Post: [
          {
            name: 'Tag',
            type: 'ManyToMany',
            referenceName: 'Tag', // PascalCase entity name
            join: true, // Owning side by default for unidirectional
            biDirectional: false,
            joinTableName: undefined,
            joinColumnName: undefined,
            inverseJoinColumnName: undefined,
            inverseReferenceName: undefined, // Correct: No inverse name for unidirectional
          },
        ],
        // No entry expected for Tag
      };

      const result = parseRelationships(relationships);
      expect(result).toEqual(expected);
    });

    it('should handle join table details correctly', () => {
        const relationships: ApsorcRelationship[] = [
          {
            from: 'Student',
            to: 'Course',
            type: 'ManyToMany',
            // eslint-disable-next-line camelcase
            bi_directional: true,
            // UNUSED: eslint-disable-next-line camelcase
            joinTableName: 'enrollments',
            // UNUSED: eslint-disable-next-line camelcase
            joinColumnName: 'student_id',
            // UNUSED: eslint-disable-next-line camelcase
            inverseJoinColumnName: 'course_id',
          },
        ];
  
        const expected: RelationshipMap = {
          Student: [
            {
              name: 'Course',
              type: 'ManyToMany',
              referenceName: 'Course', // PascalCase entity name
              join: true, // Has join details, so owning side
              biDirectional: true,
              joinTableName: 'enrollments',
              joinColumnName: 'student_id',
              inverseJoinColumnName: 'course_id',
              inverseReferenceName: 'Student', // PascalCase entity name
            },
          ],
          Course: [
            {
              name: 'Student',
              type: 'ManyToMany',
              referenceName: 'Student', // PascalCase entity name
              join: false, // Inverse side is not owning
              biDirectional: true,
              joinTableName: undefined, // Details only on owning side map
              joinColumnName: undefined,
              inverseJoinColumnName: undefined,
              inverseReferenceName: 'Course', // PascalCase entity name
            },
          ],
        };
  
        const result = parseRelationships(relationships);
        expect(result).toEqual(expected);
      });

  });

  describe('Mixed Relationship Types', () => {
    it('should correctly parse ManyToMany alongside other types', () => {
        const relationships: ApsorcRelationship[] = [
          {
            from: 'User',
            to: 'Profile',
            type: 'OneToOne',
            // eslint-disable-next-line camelcase
            bi_directional: true,
            // eslint-disable-next-line camelcase
            to_name: 'userProfile'
          },
          {
            from: 'User',
            to: 'Post',
            type: 'OneToMany',
            // eslint-disable-next-line camelcase
            bi_directional: true // Implies ManyToOne on Post
          },
          {
            from: 'Role',
            to: 'User',
            type: 'ManyToMany',
            // eslint-disable-next-line camelcase
            bi_directional: true
          }
        ];
  
        const result = parseRelationships(relationships);
  
        // Check User relationships
        expect(result.User).toHaveLength(3);
        expect(result.User).toContainEqual(expect.objectContaining({ name: 'Profile', type: 'OneToOne', referenceName: 'userProfile', biDirectional: true, join: false })); // Expect preserved camelCase
        expect(result.User).toContainEqual(expect.objectContaining({ name: 'Post', type: 'OneToMany', referenceName: 'Post', biDirectional: true })); // PascalCase entity name
        expect(result.User).toContainEqual(expect.objectContaining({ name: 'Role', type: 'ManyToMany', referenceName: 'Role', biDirectional: true, join: false })); // PascalCase entity name

        // Check Profile relationship
        expect(result.Profile).toHaveLength(1);
        expect(result.Profile).toContainEqual(expect.objectContaining({ 
          name: 'User', 
          type: 'OneToOne', 
          referenceName: 'User', // PascalCase entity name
          biDirectional: true, 
          join: true 
        }));

        // Check Post relationship
        expect(result.Post).toHaveLength(1);
        expect(result.Post).toContainEqual(expect.objectContaining({ 
          name: 'User', 
          type: 'ManyToOne', 
          referenceName: 'User', // PascalCase entity name
          biDirectional: true 
        }));
        
        // Check Role relationship
        expect(result.Role).toHaveLength(1);
        expect(result.Role).toContainEqual(expect.objectContaining({ name: 'User', type: 'ManyToMany', referenceName: 'User', biDirectional: true, join: true })); // PascalCase entity name
      });
  });
});

describe('getRelationshipForTemplate', () => {

  // Mock console.warn to prevent test output clutter
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => { /* No output */ });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('UUID Primary Key Support', () => {
    it('should populate referencedEntityPrimaryKeyType as uuid when referenced entity has uuid primary key', () => {
      const entities = [
        { name: 'User', primaryKeyType: 'uuid' as const },
        { name: 'Account', primaryKeyType: 'serial' as const },
      ];

      const relationships: Relationship[] = [
        {
          name: 'User',
          type: 'ManyToOne',
          referenceName: null,
          nullable: false,
          index: false,
        },
      ];

      const result = getRelationshipForTemplate('Account', relationships, entities);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        name: 'User',
        type: 'ManyToOne',
        referencedEntityPrimaryKeyType: 'uuid',
      });
    });

    it('should populate referencedEntityPrimaryKeyType as serial when referenced entity has serial primary key', () => {
      const entities = [
        { name: 'User', primaryKeyType: 'serial' as const },
        { name: 'Post', primaryKeyType: 'serial' as const },
      ];

      const relationships: Relationship[] = [
        {
          name: 'User',
          type: 'ManyToOne',
          referenceName: null,
          nullable: false,
          index: false,
        },
      ];

      const result = getRelationshipForTemplate('Post', relationships, entities);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        name: 'User',
        type: 'ManyToOne',
        referencedEntityPrimaryKeyType: 'serial',
      });
    });

    it('should default referencedEntityPrimaryKeyType to serial when entity does not specify primaryKeyType', () => {
      const entities = [
        { name: 'User' }, // No primaryKeyType specified
        { name: 'Post', primaryKeyType: 'serial' as const },
      ];

      const relationships: Relationship[] = [
        {
          name: 'User',
          type: 'ManyToOne',
          referenceName: null,
          nullable: false,
          index: false,
        },
      ];

      const result = getRelationshipForTemplate('Post', relationships, entities);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        name: 'User',
        type: 'ManyToOne',
        referencedEntityPrimaryKeyType: 'serial',
      });
    });

    it('should default referencedEntityPrimaryKeyType to serial when entities array is not provided', () => {
      const relationships: Relationship[] = [
        {
          name: 'User',
          type: 'ManyToOne',
          referenceName: null,
          nullable: false,
          index: false,
        },
      ];

      const result = getRelationshipForTemplate('Post', relationships);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        name: 'User',
        type: 'ManyToOne',
        referencedEntityPrimaryKeyType: 'serial',
      });
    });

    it('should handle multiple relationships with mixed primary key types', () => {
      const entities = [
        { name: 'User', primaryKeyType: 'uuid' as const },
        { name: 'Organization', primaryKeyType: 'serial' as const },
        { name: 'Team', primaryKeyType: 'uuid' as const },
        { name: 'Post', primaryKeyType: 'serial' as const },
      ];

      const relationships: Relationship[] = [
        {
          name: 'User',
          type: 'ManyToOne',
          referenceName: null,
          nullable: false,
          index: true,
        },
        {
          name: 'Organization',
          type: 'ManyToOne',
          referenceName: null,
          nullable: false,
          index: false,
        },
        {
          name: 'Team',
          type: 'ManyToOne',
          referenceName: null,
          nullable: true,
          index: false,
        },
      ];

      const result = getRelationshipForTemplate('Post', relationships, entities);

      expect(result).toHaveLength(3);

      const userRel = result.find(r => r.name === 'User');
      expect(userRel).toMatchObject({
        name: 'User',
        type: 'ManyToOne',
        referencedEntityPrimaryKeyType: 'uuid',
      });

      const orgRel = result.find(r => r.name === 'Organization');
      expect(orgRel).toMatchObject({
        name: 'Organization',
        type: 'ManyToOne',
        referencedEntityPrimaryKeyType: 'serial',
      });

      const teamRel = result.find(r => r.name === 'Team');
      expect(teamRel).toMatchObject({
        name: 'Team',
        type: 'ManyToOne',
        referencedEntityPrimaryKeyType: 'uuid',
      });
    });
  });
}); 