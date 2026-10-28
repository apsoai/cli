INSERT INTO "company" ("id", "name") VALUES (1, 'Acme'), (2, 'Globex');
SELECT setval('company_id_seq', 2);
INSERT INTO "contact" ("id", "fullName", "phone", "status", "score", "companyId") VALUES
  (1, 'Ada Lovelace', '555-0101', 'active', '12', 1),
  (2, 'Alan Turing', '555-0102', 'archived', '7', 1),
  (3, 'Grace Hopper', NULL, 'lead', ' 42', 2),
  (4, 'Edsger Dijkstra', '555-0104', 'archived', 'n/a', 2);
SELECT setval('contact_id_seq', 4);
