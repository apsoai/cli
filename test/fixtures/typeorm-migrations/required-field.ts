import { MigrationInterface, QueryRunner } from "typeorm";

export class SchemaUpdateMigration1793049726507 implements MigrationInterface {
    name = 'SchemaUpdateMigration1793049726507'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."company_region_enum" AS ENUM('us', 'eu', 'apac')`);
        await queryRunner.query(`ALTER TABLE "company" ADD "region" "public"."company_region_enum" NOT NULL DEFAULT 'us'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "company" DROP COLUMN "region"`);
        await queryRunner.query(`DROP TYPE "public"."company_region_enum"`);
    }

}
