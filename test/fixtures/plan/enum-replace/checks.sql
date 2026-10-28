SELECT (SELECT count(*) FROM "contact" WHERE "status" = 'closed' AND "id" IN (2, 4)) = 2 AS ok, 'archived contacts are now closed' AS label;
SELECT (SELECT count(*) FROM "contact" WHERE ("id", "status"::text) IN ((1, 'active'), (3, 'lead'))) = 2 AS ok, 'other statuses are unchanged' AS label;
