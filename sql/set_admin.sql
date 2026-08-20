-- تأكد أولاً أن الصف موجود (لو مش موجود شغّل sql/backfill_profiles.sql قبل هذا)
update public.profiles
set role = 'admin', full_name = 'المدير'
where id = '1976e4e3-b42e-48e9-8565-8bfd961a8ae3';

-- تحقق من النتيجة
select id, full_name, role from public.profiles
where id = '1976e4e3-b42e-48e9-8565-8bfd961a8ae3';
