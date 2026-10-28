import { MigrationInterface, QueryRunner } from "typeorm";

export class SchemaUpdateMigration1793049700136 implements MigrationInterface {
    name = 'SchemaUpdateMigration1793049700136'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "contact" DROP COLUMN "score"`);
        await queryRunner.query(`ALTER TABLE "contact" ADD "score" integer`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "contact" DROP COLUMN "score"`);
        await queryRunner.query(`ALTER TABLE "contact" ADD "score" text`);
    }

}
