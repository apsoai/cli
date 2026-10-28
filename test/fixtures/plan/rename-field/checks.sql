SELECT (SELECT count(*) FROM "contact" WHERE ("id", "mobilePhone") IN ((1, '555-0101'), (2, '555-0102'), (4, '555-0104'))) = 3 AS ok, 'phone numbers moved to mobilePhone' AS label;
SELECT (SELECT "mobilePhone" FROM "contact" WHERE "id" = 3) IS NULL AS ok, 'a missing phone stays missing' AS label;
