-- Synthetic, local-only fixture matching the approved IDs; never a live migration.
insert into auth.users(id) values('301b1414-cf13-4e49-b08b-f261632c6832'),('23cacb27-4952-4a36-9bd5-efbf2595963e'),('428aece2-77e3-46a4-9d67-a7990f80263c');
insert into public.organizations(id,name) values('6df5babd-b3d8-4b6a-bd39-03adb779db47','The Timberland');
insert into public.organization_members(id,organization_id,profile_id,role) values
 ('354e570b-d05d-4b07-bddd-ba483c918944','6df5babd-b3d8-4b6a-bd39-03adb779db47','301b1414-cf13-4e49-b08b-f261632c6832','owner'),
 ('32d17bba-0b65-4578-8030-61663094141f','6df5babd-b3d8-4b6a-bd39-03adb779db47','23cacb27-4952-4a36-9bd5-efbf2595963e','treasurer'),
 ('e15b31a8-4239-4fc2-9e4c-f16247b0d345','6df5babd-b3d8-4b6a-bd39-03adb779db47','428aece2-77e3-46a4-9d67-a7990f80263c','member');
insert into public.collections(id,organization_id,title,created_by) values('e87919ff-4d37-4aaf-a018-33c3f7a42fc7','6df5babd-b3d8-4b6a-bd39-03adb779db47','1st Semester Collection','301b1414-cf13-4e49-b08b-f261632c6832');
insert into public.organization_directory_members(id,organization_id,display_name,status) values
 ('b586b9cd-5a0c-455c-af3a-1169e2395580','6df5babd-b3d8-4b6a-bd39-03adb779db47','Historical A','archived'),
 ('b79111c6-6e1d-4a22-ae0b-ecb5157c7253','6df5babd-b3d8-4b6a-bd39-03adb779db47','Historical B','archived'),
 ('300b3655-b3dd-4a5f-b99a-f3d46e0d49f8','6df5babd-b3d8-4b6a-bd39-03adb779db47','test','active');
insert into public.obligations(id,organization_id,collection_id,member_id,directory_member_id,amount_centavos,status) values
 ('50ebaf1e-c265-4b9b-abcd-b76393d9d758','6df5babd-b3d8-4b6a-bd39-03adb779db47','e87919ff-4d37-4aaf-a018-33c3f7a42fc7','354e570b-d05d-4b07-bddd-ba483c918944','b586b9cd-5a0c-455c-af3a-1169e2395580',25000,'paid'),
 ('79c8fbe3-1b9d-4dbb-ba94-07ae0104afb7','6df5babd-b3d8-4b6a-bd39-03adb779db47','e87919ff-4d37-4aaf-a018-33c3f7a42fc7','32d17bba-0b65-4578-8030-61663094141f','b79111c6-6e1d-4a22-ae0b-ecb5157c7253',25000,'pending');
insert into public.payments(id,organization_id,collection_id,obligation_id,amount_centavos,payment_method,receipt_number,idempotency_key,recorded_by)
 values('70c48bfe-7daf-4b27-b0b1-be4a7ef12dde','6df5babd-b3d8-4b6a-bd39-03adb779db47','e87919ff-4d37-4aaf-a018-33c3f7a42fc7','50ebaf1e-c265-4b9b-abcd-b76393d9d758',25000,'cash','RCP-2026-0001','fixture-only','301b1414-cf13-4e49-b08b-f261632c6832');
insert into public.receipt_counters values('6df5babd-b3d8-4b6a-bd39-03adb779db47',2026,1);
