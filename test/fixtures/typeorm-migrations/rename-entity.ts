import { MigrationInterface, QueryRunner } from "typeorm";

export class SchemaUpdateMigration1793049700178 implements MigrationInterface {
    name = 'SchemaUpdateMigration1793049700178'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "contact" DROP CONSTRAINT "FK_196374b312744cf2c400c962383"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_196374b312744cf2c400c96238"`);
        await queryRunner.query(`ALTER TABLE "contact" RENAME COLUMN "companyId" TO "organizationId"`);
        await queryRunner.query(`CREATE TABLE "organization" ("id" SERIAL NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "name" text NOT NULL, CONSTRAINT "PK_472c1f99a32def1b0abb219cd67" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_7719d73cd16a9f57ecc6ac24b3" ON "contact" ("organizationId") `);
        await queryRunner.query(`ALTER TABLE "contact" ADD CONSTRAINT "FK_7719d73cd16a9f57ecc6ac24b3d" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "contact" DROP CONSTRAINT "FK_7719d73cd16a9f57ecc6ac24b3d"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_7719d73cd16a9f57ecc6ac24b3"`);
        await queryRunner.query(`DROP TABLE "organization"`);
        await queryRunner.query(`ALTER TABLE "contact" RENAME COLUMN "organizationId" TO "companyId"`);
        await queryRunner.query(`CREATE INDEX "IDX_196374b312744cf2c400c96238" ON "contact" ("companyId") `);
        await queryRunner.query(`ALTER TABLE "contact" ADD CONSTRAINT "FK_196374b312744cf2c400c962383" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

}
