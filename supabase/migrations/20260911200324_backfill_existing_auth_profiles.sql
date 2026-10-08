insert into public.profiles (id, display_name)
select
  users.id,
  case
    when nullif(btrim(users.raw_user_meta_data ->> 'display_name'), '') is not null
      and char_length(btrim(users.raw_user_meta_data ->> 'display_name')) between 2 and 80
      then btrim(users.raw_user_meta_data ->> 'display_name')
    else null
  end
from auth.users as users
on conflict (id) do nothing;
