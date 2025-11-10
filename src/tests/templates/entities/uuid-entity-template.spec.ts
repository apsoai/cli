import * as Eta from 'eta';
import * as path from 'path';
import { describe, it, expect, beforeAll } from '@jest/globals';

describe('UUID Entity Template Tests', () => {
  beforeAll(() => {
    Eta.configure({
      views: path.join(__dirname, '../../../lib/templates'),
      cache: false
    });
  });

  describe('UUID Primary Key', () => {
    it('should render entity with UUID primary key', async () => {
      const data = {
        name: 'User',
        snakeCasedName: 'user',
        createPrimaryKey: true,
        primaryKeyType: 'uuid',
        createdAt: true,
        updatedAt: true,
        columns: [],
        associations: [],
        indexes: [],
        uniques: [],
        entitiesToImport: [],
        apiType: 'rest',
        importEnums: false
      };

      const rendered = await Eta.renderFileAsync('./entities/entity', data);

      // Should use @Column with uuid type
      expect(rendered).toContain("@Column({ type: 'uuid' })");

      // Should use @PrimaryColumn instead of @PrimaryGeneratedColumn
      expect(rendered).toContain('@PrimaryColumn()');
      expect(rendered).not.toContain('@PrimaryGeneratedColumn()');

      // Should declare id as string
      expect(rendered).toContain('id: string;');
      expect(rendered).not.toContain('id!: number;');
    });

    it('should render entity with serial (auto-increment) primary key', async () => {
      const data = {
        name: 'Post',
        snakeCasedName: 'post',
        createPrimaryKey: true,
        primaryKeyType: 'serial',
        createdAt: true,
        updatedAt: true,
        columns: [],
        associations: [],
        indexes: [],
        uniques: [],
        entitiesToImport: [],
        apiType: 'rest',
        importEnums: false
      };

      const rendered = await Eta.renderFileAsync('./entities/entity', data);

      // Should use @PrimaryGeneratedColumn
      expect(rendered).toContain('@PrimaryGeneratedColumn()');
      expect(rendered).not.toContain("@Column({ type: 'uuid' })");
      expect(rendered).not.toContain('@PrimaryColumn()');

      // Should declare id as number
      expect(rendered).toContain('id!: number;');
      expect(rendered).not.toContain('id: string;');
    });

    it('should default to serial primary key when primaryKeyType is not specified', async () => {
      const data = {
        name: 'Comment',
        snakeCasedName: 'comment',
        createPrimaryKey: true,
        // primaryKeyType not specified
        createdAt: true,
        updatedAt: true,
        columns: [],
        associations: [],
        indexes: [],
        uniques: [],
        entitiesToImport: [],
        apiType: 'rest',
        importEnums: false
      };

      const rendered = await Eta.renderFileAsync('./entities/entity', data);

      // Should default to serial (auto-increment)
      expect(rendered).toContain('@PrimaryGeneratedColumn()');
      expect(rendered).toContain('id!: number;');
    });
  });

  describe('UUID Foreign Keys', () => {
    it('should render ManyToOne relationship with UUID foreign key when referenced entity has UUID primary key', async () => {
      const data = {
        name: 'Account',
        snakeCasedName: 'account',
        createPrimaryKey: true,
        primaryKeyType: 'serial',
        createdAt: true,
        updatedAt: true,
        columns: [],
        associations: [
          {
            name: 'User',
            type: 'ManyToOne',
            relationshipName: 'user',
            pluralizedRelationshipName: 'users',
            pluralizedName: 'users',
            camelCasedName: 'user',
            camelCasedId: 'userId',
            entityName: 'account',
            joinTable: false,
            biDirectional: true,
            inverseSidePropertyName: 'accounts',
            referencedEntityPrimaryKeyType: 'uuid',
            nullable: false,
            index: false
          }
        ],
        indexes: [],
        uniques: [],
        entitiesToImport: ['User'],
        apiType: 'rest',
        importEnums: false
      };

      const rendered = await Eta.renderFileAsync('./entities/entity', data);

      // Should have ManyToOne decorator
      expect(rendered).toContain('@ManyToOne(() => User');

      // Should have JoinColumn
      expect(rendered).toContain("@JoinColumn({ name: 'userId' })");

      // Should declare relationship property
      expect(rendered).toContain('user: User;');

      // Should have UUID foreign key column
      expect(rendered).toContain('@Column({ type: "uuid"');
      expect(rendered).toContain('userId: string;');

      // Should NOT have integer foreign key
      expect(rendered).not.toContain('userId: number;');
    });

    it('should render ManyToOne relationship with integer foreign key when referenced entity has serial primary key', async () => {
      const data = {
        name: 'Post',
        snakeCasedName: 'post',
        createPrimaryKey: true,
        primaryKeyType: 'serial',
        createdAt: true,
        updatedAt: true,
        columns: [],
        associations: [
          {
            name: 'User',
            type: 'ManyToOne',
            relationshipName: 'user',
            pluralizedRelationshipName: 'users',
            pluralizedName: 'users',
            camelCasedName: 'user',
            camelCasedId: 'userId',
            entityName: 'post',
            joinTable: false,
            biDirectional: true,
            inverseSidePropertyName: 'posts',
            referencedEntityPrimaryKeyType: 'serial',
            nullable: false,
            index: true
          }
        ],
        indexes: [],
        uniques: [],
        entitiesToImport: ['User'],
        apiType: 'rest',
        importEnums: false
      };

      const rendered = await Eta.renderFileAsync('./entities/entity', data);

      // Should have ManyToOne decorator
      expect(rendered).toContain('@ManyToOne(() => User');

      // Should have index since index: true
      expect(rendered).toContain('@Index()');

      // Should have integer foreign key column
      expect(rendered).toContain('@Column({ type: "integer"');
      expect(rendered).toContain('userId: number;');

      // Should NOT have UUID foreign key
      expect(rendered).not.toContain('userId: string;');
    });

    it('should handle nullable UUID foreign keys', async () => {
      const data = {
        name: 'Profile',
        snakeCasedName: 'profile',
        createPrimaryKey: true,
        primaryKeyType: 'uuid',
        createdAt: true,
        updatedAt: true,
        columns: [],
        associations: [
          {
            name: 'Organization',
            type: 'ManyToOne',
            relationshipName: 'organization',
            pluralizedRelationshipName: 'organizations',
            pluralizedName: 'organizations',
            camelCasedName: 'organization',
            camelCasedId: 'organizationId',
            entityName: 'profile',
            joinTable: false,
            biDirectional: false,
            referencedEntityPrimaryKeyType: 'uuid',
            nullable: true,
            index: false
          }
        ],
        indexes: [],
        uniques: [],
        entitiesToImport: ['Organization'],
        apiType: 'rest',
        importEnums: false
      };

      const rendered = await Eta.renderFileAsync('./entities/entity', data);

      // Should have nullable UUID foreign key
      expect(rendered).toContain('@Column({ type: "uuid",  nullable: true');
      expect(rendered).toContain('organizationId: string;');
    });

    it('should handle multiple relationships with mixed UUID and serial foreign keys', async () => {
      const data = {
        name: 'Comment',
        snakeCasedName: 'comment',
        createPrimaryKey: true,
        primaryKeyType: 'serial',
        createdAt: true,
        updatedAt: true,
        columns: [],
        associations: [
          {
            name: 'User',
            type: 'ManyToOne',
            relationshipName: 'user',
            pluralizedRelationshipName: 'users',
            pluralizedName: 'users',
            camelCasedName: 'user',
            camelCasedId: 'userId',
            entityName: 'comment',
            joinTable: false,
            biDirectional: true,
            inverseSidePropertyName: 'comments',
            referencedEntityPrimaryKeyType: 'uuid',
            nullable: false,
            index: true
          },
          {
            name: 'Post',
            type: 'ManyToOne',
            relationshipName: 'post',
            pluralizedRelationshipName: 'posts',
            pluralizedName: 'posts',
            camelCasedName: 'post',
            camelCasedId: 'postId',
            entityName: 'comment',
            joinTable: false,
            biDirectional: true,
            inverseSidePropertyName: 'comments',
            referencedEntityPrimaryKeyType: 'serial',
            nullable: false,
            index: true
          }
        ],
        indexes: [],
        uniques: [],
        entitiesToImport: ['User', 'Post'],
        apiType: 'rest',
        importEnums: false
      };

      const rendered = await Eta.renderFileAsync('./entities/entity', data);

      // Should have UUID foreign key for User
      expect(rendered).toContain('@Column({ type: "uuid"');
      expect(rendered).toContain('userId: string;');

      // Should have integer foreign key for Post
      expect(rendered).toContain('@Column({ type: "integer"');
      expect(rendered).toContain('postId: number;');

      // Should have both relationships
      expect(rendered).toContain('user: User;');
      expect(rendered).toContain('post: Post;');
    });
  });
});
