-- 007_opportunity_contract_type.sql
--
-- Extend the existing opportunity tracking-type allowlist with Contract.
-- TiDB does not support dropping and adding a CHECK constraint in the same
-- ALTER TABLE statement. Keep these as two ordered DDL statements.
-- Existing opportunity rows already use one of the four prior values.

ALTER TABLE opportunities
  DROP CONSTRAINT chk_opportunities_type;

ALTER TABLE opportunities
  ADD CONSTRAINT chk_opportunities_type
    CHECK (`type` IN ('Internship', 'Full-time', 'Part-time', 'Freelance', 'Contract'));
