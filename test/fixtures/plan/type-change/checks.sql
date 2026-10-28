SELECT (SELECT count(*) FROM "contact" WHERE ("id", "score") IN ((1, 12), (2, 7), (3, 42))) = 3 AS ok, 'numeric scores survive the cast' AS label;
SELECT (SELECT "score" FROM "contact" WHERE "id" = 4) IS NULL AS ok, 'a score that is not a number becomes null' AS label;
