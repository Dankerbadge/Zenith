-- Public storage bucket for post images.
-- Path convention: post-images/<auth.uid()>/<timestamp>-<random>.jpg

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'post-images',
  'post-images',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = true,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "post_images_public_read" on storage.objects;
create policy "post_images_public_read"
  on storage.objects for select
  to public
  using (bucket_id = 'post-images');
drop policy if exists "post_images_insert_own_folder" on storage.objects;
create policy "post_images_insert_own_folder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'post-images'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
drop policy if exists "post_images_update_own_folder" on storage.objects;
create policy "post_images_update_own_folder"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'post-images'
    and auth.uid()::text = (storage.foldername(name))[1]
  )
  with check (
    bucket_id = 'post-images'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
drop policy if exists "post_images_delete_own_folder" on storage.objects;
create policy "post_images_delete_own_folder"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'post-images'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
