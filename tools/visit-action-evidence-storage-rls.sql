-- Included by manager-report-scopes-hardening-rls.sql after its disposable fixtures
-- and candidate migrations have been loaded.
-- Prior tests leave request.jwt.claim.sub set locally; restore the fixture Owner
-- before setup inserts so branch-scope triggers do not mistake them for a Manager.
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '82000000-0000-4000-8000-000000000001', true);

-- Legacy visit evidence remains a task-evidence object with a NULL action link.
INSERT INTO storage.objects(bucket_id, name)
VALUES ('task-evidence', 'legacy/old-visit-photo.png');
INSERT INTO public.visit_evidence(
  id, visit_id, result_id, file_path, file_name, mime_type, uploaded_by, client_key
) VALUES (
  '8d000000-0000-4000-8000-000000000002',
  '89000000-0000-4000-8000-000000000001',
  '8b000000-0000-4000-8000-000000000001',
  'legacy/old-visit-photo.png', 'old-visit-photo.png', 'image/png',
  '82000000-0000-4000-8000-000000000001', '8a000000-0000-4000-8000-000000000001'
);

-- The branch-scoped Manager created this action; private uploads must use the
-- persisted action ID and the authenticated uploader ID in the object path.
UPDATE public.visit_action_items
SET created_by = '82000000-0000-4000-8000-000000000010',
    assigned_to = '82000000-0000-4000-8000-000000000006'
WHERE id = '8c000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '82000000-0000-4000-8000-000000000010', true);
DO $test$
DECLARE n integer; denied boolean := false;
BEGIN
  INSERT INTO storage.objects(bucket_id, name)
  VALUES (
    'visit-action-evidence',
    '8c000000-0000-4000-8000-000000000001/82000000-0000-4000-8000-000000000010/new-private-proof.png'
  );
  INSERT INTO public.visit_evidence(
    id, visit_id, result_id, action_item_id, file_path, file_name, mime_type, uploaded_by, client_key
  ) VALUES (
    '8d000000-0000-4000-8000-000000000003',
    '89000000-0000-4000-8000-000000000001',
    '8b000000-0000-4000-8000-000000000001',
    '8c000000-0000-4000-8000-000000000001',
    '8c000000-0000-4000-8000-000000000001/82000000-0000-4000-8000-000000000010/new-private-proof.png',
    'new-private-proof.png', 'image/png', '82000000-0000-4000-8000-000000000010',
    '8a000000-0000-4000-8000-000000000001'
  );
  SELECT count(*) INTO n FROM public.visit_evidence
  WHERE id = '8d000000-0000-4000-8000-000000000003'
    AND action_item_id = '8c000000-0000-4000-8000-000000000001'
    AND file_path = '8c000000-0000-4000-8000-000000000001/82000000-0000-4000-8000-000000000010/new-private-proof.png';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL private object upload was not associated with its saved action row'; END IF;
  SELECT count(*) INTO n FROM storage.objects
  WHERE bucket_id = 'visit-action-evidence'
    AND name = '8c000000-0000-4000-8000-000000000001/82000000-0000-4000-8000-000000000010/new-private-proof.png';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL private object path was not stored in the dedicated bucket'; END IF;
  SELECT count(*) INTO n FROM public.visit_evidence
  WHERE id = '8d000000-0000-4000-8000-000000000002'
    AND action_item_id IS NULL
    AND file_path = 'legacy/old-visit-photo.png';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL legacy evidence row was changed while adding private evidence'; END IF;

  BEGIN
    INSERT INTO storage.objects(bucket_id, name)
    VALUES (
      'visit-action-evidence',
      '8c000000-0000-4000-8000-000000000001/82000000-0000-4000-8000-000000000009/wrong-uploader.png'
    );
    RAISE EXCEPTION 'FAIL private upload accepted a path naming a different uploader';
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'FAIL expected private upload path/uploader mismatch denial'; END IF;
  RAISE NOTICE 'PASS in-scope uploader stores a private object at action/uploader/path and links the visit_evidence row without changing legacy evidence';
END;
$test$;
RESET ROLE;

-- Anonymous users have table privileges in this harness, so zero visible rows
-- proves the bucket SELECT policy itself denies unauthenticated reads.
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.sub', '', true);
DO $test$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id = 'visit-action-evidence';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL anonymous user read % private action evidence objects', n; END IF;
  RAISE NOTICE 'PASS unauthenticated storage read is denied';
END;
$test$;
RESET ROLE;

-- The explicitly assigned Branch A Supervisor sees the in-branch evidence but cannot
-- read the private object belonging to the pending Branch B action.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '82000000-0000-4000-8000-000000000006', true);
DO $test$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM storage.objects
  WHERE bucket_id = 'visit-action-evidence'
    AND name = '8c000000-0000-4000-8000-000000000001/82000000-0000-4000-8000-000000000010/new-private-proof.png';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL assigned in-branch Supervisor could not read action evidence'; END IF;
  SELECT count(*) INTO n FROM storage.objects
  WHERE bucket_id = 'visit-action-evidence'
    AND name = '8c000000-0000-4000-8000-000000000002/82000000-0000-4000-8000-000000000001/branch-b.png';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL Branch A Supervisor read private evidence from Branch B'; END IF;
  RAISE NOTICE 'PASS assigned user can read in-branch evidence; cross-branch storage read is denied';
END;
$test$;
RESET ROLE;

-- The explicit reviewer can read a pending action's proof, but not unrelated
-- open evidence that is not assigned to them and does not need review.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '82000000-0000-4000-8000-000000000009', true);
DO $test$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM storage.objects
  WHERE bucket_id = 'visit-action-evidence'
    AND name = '8c000000-0000-4000-8000-000000000002/82000000-0000-4000-8000-000000000001/branch-b.png';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL authorized reviewer could not read the pending action evidence'; END IF;
  SELECT count(*) INTO n FROM storage.objects
  WHERE bucket_id = 'visit-action-evidence'
    AND name = '8c000000-0000-4000-8000-000000000001/82000000-0000-4000-8000-000000000010/new-private-proof.png';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL reviewer read unrelated open evidence'; END IF;
  RAISE NOTICE 'PASS in-scope reviewer can read pending proof without gaining unrelated action evidence';
END;
$test$;
RESET ROLE;
