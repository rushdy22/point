-- ينشئ صف profile لأي مستخدم في auth.users ليس له صف بالفعل في public.profiles
insert into public.profiles (id, full_name, username, role)
select
  u.id,
  coalesce(u.raw_user_meta_data->>'full_name', ''),
  u.email,
  'cashier'
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;

-- تحقق من النتيجة
select id, email from auth.users;
select * from public.profiles;
