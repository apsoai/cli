import { MigrationInterface, QueryRunner } from "typeorm";

export class SchemaUpdateMigration1793049717243 implements MigrationInterface {
    name = 'SchemaUpdateMigration1793049717243'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "contact" RENAME COLUMN "phone" TO "mobilePhone"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "contact" RENAME COLUMN "mobilePhone" TO "phone"`);
    }

}
