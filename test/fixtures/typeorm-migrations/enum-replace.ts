import { MigrationInterface, QueryRunner } from "typeorm";

export class SchemaUpdateMigration1793049700161 implements MigrationInterface {
    name = 'SchemaUpdateMigration1793049700161'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TYPE "public"."contact_status_enum" RENAME TO "contact_status_enum_old"`);
        await queryRunner.query(`CREATE TYPE "public"."contact_status_enum" AS ENUM('lead', 'active', 'closed')`);
        await queryRunner.query(`ALTER TABLE "contact" ALTER COLUMN "status" DROP DEFAULT`);
        await queryRunner.query(`ALTER TABLE "contact" ALTER COLUMN "status" TYPE "public"."contact_status_enum" USING "status"::"text"::"public"."contact_status_enum"`);
        await queryRunner.query(`ALTER TABLE "contact" ALTER COLUMN "status" SET DEFAULT 'lead'`);
        await queryRunner.query(`DROP TYPE "public"."contact_status_enum_old"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."contact_status_enum_old" AS ENUM('lead', 'active', 'archived')`);
        await queryRunner.query(`ALTER TABLE "contact" ALTER COLUMN "status" DROP DEFAULT`);
        await queryRunner.query(`ALTER TABLE "contact" ALTER COLUMN "status" TYPE "public"."contact_status_enum_old" USING "status"::"text"::"public"."contact_status_enum_old"`);
        await queryRunner.query(`ALTER TABLE "contact" ALTER COLUMN "status" SET DEFAULT 'lead'`);
        await queryRunner.query(`DROP TYPE "public"."contact_status_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."contact_status_enum_old" RENAME TO "contact_status_enum"`);
    }

}
