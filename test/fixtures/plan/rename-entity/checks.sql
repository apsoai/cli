SELECT (SELECT count(*) FROM "organization") = 2 AS ok, 'both companies are now organizations' AS label;
SELECT (SELECT count(*) FROM "contact" WHERE ("id", "organizationId") IN ((1, 1), (2, 1), (3, 2), (4, 2))) = 4 AS ok, 'each contact keeps its organization' AS label;
SELECT nextval('organization_id_seq') = 3 AS ok, 'new organizations continue the old id sequence' AS label;
