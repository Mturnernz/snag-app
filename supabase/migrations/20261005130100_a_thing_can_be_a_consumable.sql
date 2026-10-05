-- ============================================================================
-- A consumable: something bought and used up.
-- ============================================================================
--
-- Dishwasher tablets, weed killer, a box of filters. The house record held
-- what is *in* the house; this is what the house goes through, recorded so the
-- brand and the exact product are on hand in the aisle, and linked to the
-- appliance that uses it (`home.thing_uses`, next migration).
--
-- Alone in its migration: Postgres will not let a new enum value be used in
-- the transaction that added it, and a migration is one transaction.

alter type home.thing_kind add value if not exists 'consumable';
