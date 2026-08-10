-- Run this in Supabase -> SQL Editor.
-- IMPORTANT: replace CHANGE_ME_STRONG_PASSWORD before running.

create user "prisma" with password 'CHANGE_ME_STRONG_PASSWORD' bypassrls createdb;
grant "prisma" to "postgres";

grant usage on schema public to prisma;
grant create on schema public to prisma;
grant all on all tables in schema public to prisma;
grant all on all routines in schema public to prisma;
grant all on all sequences in schema public to prisma;

alter default privileges for role postgres in schema public grant all on tables to prisma;
alter default privileges for role postgres in schema public grant all on routines to prisma;
alter default privileges for role postgres in schema public grant all on sequences to prisma;
