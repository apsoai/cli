import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { parseRelationships } from './parse';
import { ApsorcRelationship, RelationshipMap } from '../../types';

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
            referenceName: 'entitybs', // Simplified default
            join: true, // Owning side by default if no explicit details
            biDirectional: true,
            joinTableName: undefined,
            joinColumnName: undefined,
            inverseJoinColumnName: undefined,
            inverseReferenceName: 'entityas', // Simplified default
          },
        ],
        EntityB: [
          {
            name: 'EntityA',
            type: 'ManyToMany',
            referenceName: 'entityas', // Simplified default
            join: false, // Non-owning side
            biDirectional: true,
            joinTableName: undefined,
            joinColumnName: undefined,
            inverseJoinColumnName: undefined,
            inverseReferenceName: 'entitybs', // Simplified default
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
            referenceName: 'userGroups', // Expect preserved camelCase
            join: true, // Owning side by default
            biDirectional: true,
            joinTableName: undefined,
            joinColumnName: undefined,
            inverseJoinColumnName: undefined,
            inverseReferenceName: 'users', // Simplified default
          },
        ],
        Group: [
          {
            name: 'User',
            type: 'ManyToMany',
            referenceName: 'users', // Simplified default
            join: false, // Non-owning side
            biDirectional: true,
            joinTableName: undefined,
            joinColumnName: undefined,
            inverseJoinColumnName: undefined,
            inverseReferenceName: 'userGroups', // Expect preserved camelCase
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
            referenceName: 'tags', // Simplified default
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
              referenceName: 'courses', // Simplified default
              join: true, // Has join details, so owning side
              biDirectional: true,
              joinTableName: 'enrollments',
              joinColumnName: 'student_id',
              inverseJoinColumnName: 'course_id',
              inverseReferenceName: 'students', // Simplified default
            },
          ],
          Course: [
            {
              name: 'Student',
              type: 'ManyToMany',
              referenceName: 'students', // Simplified default
              join: false, // Inverse side is not owning
              biDirectional: true,
              joinTableName: undefined, // Details only on owning side map
              joinColumnName: undefined,
              inverseJoinColumnName: undefined,
              inverseReferenceName: 'courses', // Simplified default
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
        expect(result.User).toContainEqual(expect.objectContaining({ name: 'Post', type: 'OneToMany', referenceName: 'posts', biDirectional: true })); // Simplified default
        expect(result.User).toContainEqual(expect.objectContaining({ name: 'Role', type: 'ManyToMany', referenceName: 'roles', biDirectional: true, join: false })); // Simplified default

        // Check Profile relationship
        expect(result.Profile).toHaveLength(1);
        expect(result.Profile).toContainEqual(expect.objectContaining({ name: 'User', type: 'OneToOne', referenceName: 'user', biDirectional: true, join: true })); // Simplified default singular

        // Check Post relationship
        expect(result.Post).toHaveLength(1);
        expect(result.Post).toContainEqual(expect.objectContaining({ name: 'User', type: 'ManyToOne', referenceName: 'user', biDirectional: true })); // Simplified default singular
        
        // Check Role relationship
        expect(result.Role).toHaveLength(1);
        expect(result.Role).toContainEqual(expect.objectContaining({ name: 'User', type: 'ManyToMany', referenceName: 'users', biDirectional: true, join: true })); // Simplified default
      });
  });
}); 