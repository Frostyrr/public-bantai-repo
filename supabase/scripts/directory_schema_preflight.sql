-- Review existing template candidates and duplicate identifiers before migration 009.
begin read only;
select o.id, o.organization_type, d.key, d.label, d.kind, d.active,
       count(m.id) filter (where m.attributes ? d.key) as populated_rows
from public.organizations o
left join public.directory_field_definitions d on d.organization_id=o.id
left join public.organization_directory_members m on m.organization_id=o.id
group by o.id, o.organization_type, d.key, d.label, d.kind, d.active
order by o.id,d.key;

select organization_id, identifier_key, count(*) as duplicate_value_groups
from (
 select m.organization_id, e.key as identifier_key, lower(btrim(e.value))
 from public.organization_directory_members m
 cross join lateral jsonb_each_text(m.attributes) e
 where e.key in ('student_id','employee_id','membership_id','member_id') and btrim(e.value)<>''
 group by m.organization_id,e.key,lower(btrim(e.value))
 having count(*)>1
) duplicates
group by organization_id,identifier_key;
rollback;
