-- Add an event-driven, supervisor-only inventory receiving workflow.
-- Existing request rows, checklist templates, assignments, roles and permissions stay unchanged.
BEGIN;

DO $preflight$
BEGIN
  IF pg_catalog.to_regclass('public.inventory_receipts') IS NOT NULL
     OR pg_catalog.to_regclass('public.inventory_receipt_items') IS NOT NULL THEN
    RAISE EXCEPTION 'Receiving schema preflight failed: a receipt table already exists; inspect it before migration';
  END IF;
  IF pg_catalog.to_regprocedure('public.is_inventory_receiving_branch_operational(uuid)') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.can_access_inventory_receipt_object(text,boolean)') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.get_inventory_request_receiving_lines(uuid)') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.record_inventory_receipt(uuid,uuid,text,jsonb)') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.get_open_inventory_receipt_tasks()') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.complete_inventory_receipt_item(uuid,boolean,boolean,boolean,date,text,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'Receiving schema preflight failed: a function name/signature is already present; inspect it before migration';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname IN ('inventory_receipts_object_read', 'inventory_receipts_object_upload')
  ) THEN
    RAISE EXCEPTION 'Receiving schema preflight failed: a receipt storage policy already exists; inspect it before migration';
  END IF;
END;
$preflight$;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'inventory-receipts',
  'inventory-receipts',
  false,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
)
ON CONFLICT (id) DO NOTHING;

DO $bucket_check$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM storage.buckets AS b
    WHERE b.id = 'inventory-receipts'
      AND b.name = 'inventory-receipts'
      AND b.public = false
      AND b.file_size_limit = 10485760
      AND b.allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
  ) THEN
    RAISE EXCEPTION 'The private inventory-receipts bucket already exists with unexpected settings; no bucket changes were applied';
  END IF;
END;
$bucket_check$;

CREATE TABLE IF NOT EXISTS public.inventory_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.inventory_requests(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  idempotency_key uuid NOT NULL,
  received_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  received_at timestamptz NOT NULL DEFAULT now(),
  storage_deadline_at timestamptz NOT NULL DEFAULT (now() + INTERVAL '20 minutes'),
  receipt_photo_path text NOT NULL CHECK (length(btrim(receipt_photo_path)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_receipts_request_idempotency_key UNIQUE (request_id, idempotency_key),
  CONSTRAINT inventory_receipts_photo_path_format CHECK (
    receipt_photo_path ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$'
  )
);

CREATE INDEX IF NOT EXISTS inventory_receipts_branch_received_idx
  ON public.inventory_receipts (branch_id, received_at DESC);
CREATE INDEX IF NOT EXISTS inventory_receipts_request_received_idx
  ON public.inventory_receipts (request_id, received_at DESC);

CREATE TABLE IF NOT EXISTS public.inventory_receipt_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL REFERENCES public.inventory_receipts(id) ON DELETE RESTRICT,
  request_item_id uuid NOT NULL REFERENCES public.inventory_request_items(id) ON DELETE RESTRICT,
  received_quantity numeric NOT NULL CHECK (received_quantity > 0),
  item_verified boolean,
  quantity_verified boolean,
  expiry_checked boolean,
  expiry_date date,
  package_condition text CHECK (package_condition IS NULL OR package_condition IN ('intact', 'damaged', 'compromised')),
  package_notes text CHECK (package_notes IS NULL OR length(package_notes) <= 2000),
  storage_method text CHECK (storage_method IS NULL OR storage_method IN ('FIFO', 'FEFO')),
  stored_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_receipt_items_receipt_request_item_key UNIQUE (receipt_id, request_item_id),
  CONSTRAINT inventory_receipt_items_completed_checks CHECK (
    stored_at IS NULL OR (
      item_verified IS TRUE
      AND quantity_verified IS TRUE
      AND expiry_checked IS TRUE
      AND package_condition IS NOT NULL
      AND storage_method IS NOT NULL
    )
  ),
  CONSTRAINT inventory_receipt_items_package_note_required CHECK (
    package_condition IS NULL
    OR package_condition = 'intact'
    OR NULLIF(btrim(package_notes), '') IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS inventory_receipt_items_open_idx
  ON public.inventory_receipt_items (receipt_id, stored_at);
CREATE INDEX IF NOT EXISTS inventory_receipt_items_request_item_idx
  ON public.inventory_receipt_items (request_item_id);

COMMENT ON TABLE public.inventory_receipts IS
  'One supervisor-recorded delivery arrival. Each row is one arrival portion; storage deadline is received_at + 20 minutes.';
COMMENT ON COLUMN public.inventory_receipts.received_at IS
  'Database-set arrival time; never supplied by the browser.';
COMMENT ON COLUMN public.inventory_receipts.storage_deadline_at IS
  'Generated deadline for this arrival portion: received_at plus 20 minutes. Late storage remains allowed and is recorded separately.';
COMMENT ON COLUMN public.inventory_receipts.receipt_photo_path IS
  'Path in the private inventory-receipts bucket; readable only within the authorized inventory branch scope.';
COMMENT ON TABLE public.inventory_receipt_items IS
  'Per-request-item amount delivered in one arrival portion, with checks and database-set storage completion time.';
COMMENT ON COLUMN public.inventory_receipt_items.stored_at IS
  'Database-set time when the active same-branch supervisor confirms all required checks and FIFO/FEFO storage.';

ALTER TABLE public.inventory_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_receipt_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON public.inventory_receipts, public.inventory_receipt_items FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.inventory_receipts, public.inventory_receipt_items TO authenticated;

CREATE POLICY inventory_receipts_read ON public.inventory_receipts
  FOR SELECT TO authenticated
  USING (public.can_view_inventory_branch(branch_id));

CREATE POLICY inventory_receipt_items_read ON public.inventory_receipt_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.inventory_receipts AS r
      WHERE r.id = inventory_receipt_items.receipt_id
        AND public.can_view_inventory_branch(r.branch_id)
    )
  );

CREATE OR REPLACE FUNCTION public.is_inventory_receiving_branch_operational(p_branch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.branches AS b
    WHERE b.id = p_branch_id
      AND (
        b.lifecycle_status IS NULL
        OR b.lifecycle_status = ''
        OR b.lifecycle_status = 'operational'
        OR (
          b.lifecycle_status = 'planned'
          AND b.planned_opening_date IS NOT NULL
          AND b.planned_opening_date <= (pg_catalog.timezone('Asia/Riyadh', pg_catalog.now()))::date
        )
      )
  );
$function$;

REVOKE ALL ON FUNCTION public.is_inventory_receiving_branch_operational(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_inventory_receiving_branch_operational(uuid) TO authenticated;

-- Used only by storage RLS. A write is limited to an active supervisor's own branch
-- and an existing request. Reads require a committed receipt and configured inventory scope.
CREATE OR REPLACE FUNCTION public.can_access_inventory_receipt_object(p_name text, p_for_write boolean)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_branch_id uuid;
  v_request_id uuid;
BEGIN
  IF v_user_id IS NULL OR p_name IS NULL
     OR p_name !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$' THEN
    RETURN false;
  END IF;

  v_branch_id := pg_catalog.split_part(p_name, '/', 1)::uuid;
  v_request_id := pg_catalog.split_part(p_name, '/', 2)::uuid;

  IF p_for_write THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.profiles AS p
      JOIN public.inventory_requests AS r ON r.id = v_request_id
      WHERE p.id = v_user_id
        AND p.status = 'active'
        AND p.role = 'Supervisor'
        AND p.branch_id = v_branch_id
        AND r.branch_id = v_branch_id
        AND public.is_inventory_receiving_branch_operational(v_branch_id)
    );
  END IF;

  RETURN public.can_view_inventory_branch(v_branch_id)
    AND EXISTS (
      SELECT 1
      FROM public.inventory_receipts AS r
      WHERE r.branch_id = v_branch_id
        AND r.request_id = v_request_id
        AND r.receipt_photo_path = p_name
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.can_access_inventory_receipt_object(text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_inventory_receipt_object(text, boolean) TO authenticated;

CREATE POLICY inventory_receipts_object_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'inventory-receipts'
    AND public.can_access_inventory_receipt_object(name, false)
  );

CREATE POLICY inventory_receipts_object_upload ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'inventory-receipts'
    AND owner_id = (SELECT auth.uid())::text
    AND public.can_access_inventory_receipt_object(name, true)
  );

CREATE OR REPLACE FUNCTION public.get_inventory_request_receiving_lines(p_request_id uuid)
RETURNS TABLE (
  request_item_id uuid,
  line_number smallint,
  product_name text,
  requested_quantity numeric,
  unit text,
  received_quantity numeric,
  remaining_quantity numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_profile record;
  v_request_branch_id uuid;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'يلزم تسجيل الدخول لعرض تفاصيل الاستلام';
  END IF;
  SELECT p.id, p.branch_id, p.role, p.status
    INTO v_profile
    FROM public.profiles AS p
   WHERE p.id = (SELECT auth.uid());
  IF NOT FOUND OR v_profile.status IS DISTINCT FROM 'active'
     OR v_profile.role IS DISTINCT FROM 'Supervisor' THEN
    RAISE EXCEPTION 'عرض تفاصيل الاستلام متاح للمشرف النشط فقط';
  END IF;

  SELECT r.branch_id INTO v_request_branch_id
    FROM public.inventory_requests AS r
   WHERE r.id = p_request_id;
  IF NOT FOUND OR v_request_branch_id IS DISTINCT FROM v_profile.branch_id THEN
    RAISE EXCEPTION 'الطلب غير موجود ضمن فرع حسابك';
  END IF;
  IF NOT public.is_inventory_receiving_branch_operational(v_request_branch_id) THEN
    RAISE EXCEPTION 'لا يمكن تسجيل استلام قبل افتتاح الفرع المؤكد';
  END IF;

  RETURN QUERY
  SELECT i.id,
         i.line_number,
         i.product_name,
         i.requested_quantity,
         i.unit,
         COALESCE(t.received_quantity, 0)::numeric,
         GREATEST(i.requested_quantity - COALESCE(t.received_quantity, 0), 0)::numeric
    FROM public.inventory_request_items AS i
    LEFT JOIN (
      SELECT ri.request_item_id, SUM(ri.received_quantity) AS received_quantity
        FROM public.inventory_receipt_items AS ri
        JOIN public.inventory_receipts AS r ON r.id = ri.receipt_id
       WHERE r.request_id = p_request_id
       GROUP BY ri.request_item_id
    ) AS t ON t.request_item_id = i.id
   WHERE i.request_id = p_request_id
   ORDER BY i.line_number
   LIMIT 50;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_inventory_request_receiving_lines(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_inventory_request_receiving_lines(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_inventory_receipt(
  p_request_id uuid,
  p_idempotency_key uuid,
  p_receipt_photo_path text,
  p_items jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_profile record;
  v_request_branch_id uuid;
  v_receipt_id uuid;
  v_line jsonb;
  v_item_id uuid;
  v_seen_item_ids uuid[] := '{}'::uuid[];
  v_received_quantity numeric;
  v_requested_quantity numeric;
  v_already_received numeric;
  v_mimetype text;
  v_count integer := 0;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'يلزم تسجيل الدخول لتسجيل وصول التوريد';
  END IF;
  SELECT p.id, p.branch_id, p.role, p.status
    INTO v_profile
    FROM public.profiles AS p
   WHERE p.id = (SELECT auth.uid());
  IF NOT FOUND OR v_profile.status IS DISTINCT FROM 'active'
     OR v_profile.role IS DISTINCT FROM 'Supervisor' THEN
    RAISE EXCEPTION 'تسجيل وصول التوريد متاح للمشرفين النشطين فقط';
  END IF;
  IF p_request_id IS NULL OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'رقم الطلب ومفتاح العملية مطلوبان';
  END IF;

  -- Serialize receipts for the same request and make retries with the same key idempotent.
  -- Contract: a repeated (request_id, idempotency_key) returns the first receipt,
  -- even if the retry body/photo differs. Clients must use a new key for a new arrival.
  SELECT r.branch_id INTO v_request_branch_id
    FROM public.inventory_requests AS r
   WHERE r.id = p_request_id
   FOR UPDATE;
  IF NOT FOUND OR v_request_branch_id IS DISTINCT FROM v_profile.branch_id THEN
    RAISE EXCEPTION 'الطلب غير موجود ضمن فرع حسابك';
  END IF;
  IF NOT public.is_inventory_receiving_branch_operational(v_request_branch_id) THEN
    RAISE EXCEPTION 'لا يمكن تسجيل وصول توريد قبل افتتاح الفرع المؤكد';
  END IF;

  SELECT r.id INTO v_receipt_id
    FROM public.inventory_receipts AS r
   WHERE r.request_id = p_request_id
     AND r.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN v_receipt_id;
  END IF;

  IF p_items IS NULL OR pg_catalog.jsonb_typeof(p_items) <> 'array'
     OR pg_catalog.jsonb_array_length(p_items) < 1
     OR pg_catalog.jsonb_array_length(p_items) > 50 THEN
    RAISE EXCEPTION 'أدخل كمية مستلمة واحدة على الأقل';
  END IF;
  IF p_receipt_photo_path IS NULL
     OR p_receipt_photo_path !~* (
       '^' || v_request_branch_id::text || '/' || p_request_id::text || '/' || p_idempotency_key::text || '\.(jpg|jpeg|png|webp)$'
     ) THEN
    RAISE EXCEPTION 'أرفق صورة فاتورة أو سند استلام صالحاً لهذا الطلب';
  END IF;
  SELECT o.metadata ->> 'mimetype' INTO v_mimetype
    FROM storage.objects AS o
   WHERE o.bucket_id = 'inventory-receipts'
     AND o.name = p_receipt_photo_path
     AND (o.owner = v_profile.id OR o.owner_id = v_profile.id::text);
  IF NOT FOUND OR v_mimetype NOT IN ('image/jpeg', 'image/png', 'image/webp') THEN
    RAISE EXCEPTION 'تعذر التحقق من صورة الاستلام الخاصة المرفوعة لهذا الحساب';
  END IF;

  INSERT INTO public.inventory_receipts (
    request_id, branch_id, idempotency_key, received_by, receipt_photo_path
  ) VALUES (
    p_request_id, v_request_branch_id, p_idempotency_key, v_profile.id, p_receipt_photo_path
  ) RETURNING id INTO v_receipt_id;

  FOR v_line IN
    SELECT value FROM pg_catalog.jsonb_array_elements(p_items) AS rows(value)
  LOOP
    v_count := v_count + 1;
    IF pg_catalog.jsonb_typeof(v_line) <> 'object' THEN
      RAISE EXCEPTION 'أحد أسطر الكمية المستلمة غير صالح';
    END IF;
    v_item_id := NULLIF(pg_catalog.btrim(v_line ->> 'request_item_id'), '')::uuid;
    v_received_quantity := NULLIF(pg_catalog.btrim(v_line ->> 'received_quantity'), '')::numeric;
    IF v_item_id IS NULL OR v_received_quantity IS NULL OR v_received_quantity <= 0 THEN
      RAISE EXCEPTION 'كل كمية مستلمة يجب أن تكون أكبر من صفر';
    END IF;
    IF v_item_id = ANY(v_seen_item_ids) THEN
      RAISE EXCEPTION 'لا تكرر الصنف نفسه في دفعة الاستلام الواحدة';
    END IF;
    v_seen_item_ids := pg_catalog.array_append(v_seen_item_ids, v_item_id);

    SELECT i.requested_quantity INTO v_requested_quantity
      FROM public.inventory_request_items AS i
     WHERE i.id = v_item_id
       AND i.request_id = p_request_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'أحد الأصناف لا يتبع الطلب المحدد';
    END IF;
    SELECT COALESCE(SUM(ri.received_quantity), 0)::numeric INTO v_already_received
      FROM public.inventory_receipt_items AS ri
      JOIN public.inventory_receipts AS r ON r.id = ri.receipt_id
     WHERE ri.request_item_id = v_item_id
       AND r.request_id = p_request_id;
    IF v_received_quantity > v_requested_quantity - v_already_received THEN
      RAISE EXCEPTION 'الكمية المستلمة تتجاوز المتبقي المطلوب لهذا الصنف';
    END IF;

    INSERT INTO public.inventory_receipt_items (receipt_id, request_item_id, received_quantity)
    VALUES (v_receipt_id, v_item_id, v_received_quantity);
  END LOOP;

  RETURN v_receipt_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.record_inventory_receipt(uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_inventory_receipt(uuid, uuid, text, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_open_inventory_receipt_tasks()
RETURNS TABLE (
  receipt_item_id uuid,
  receipt_id uuid,
  request_id uuid,
  request_item_id uuid,
  branch_id uuid,
  product_name text,
  unit text,
  requested_quantity numeric,
  received_quantity numeric,
  remaining_quantity numeric,
  received_at timestamptz,
  storage_deadline_at timestamptz,
  is_overdue boolean,
  receipt_photo_path text,
  supplier text,
  item_verified boolean,
  quantity_verified boolean,
  expiry_checked boolean,
  expiry_date date,
  package_condition text,
  package_notes text,
  storage_method text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_profile record;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'يلزم تسجيل الدخول لعرض مهام استلام التوريدات';
  END IF;
  SELECT p.id, p.branch_id, p.role, p.status
    INTO v_profile
    FROM public.profiles AS p
   WHERE p.id = (SELECT auth.uid());
  IF NOT FOUND OR v_profile.status IS DISTINCT FROM 'active'
     OR v_profile.role IS DISTINCT FROM 'Supervisor'
     OR v_profile.branch_id IS NULL THEN
    RAISE EXCEPTION 'مهام استلام التوريدات متاحة للمشرف النشط فقط';
  END IF;
  IF NOT public.is_inventory_receiving_branch_operational(v_profile.branch_id) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT ri.id,
         r.id,
         r.request_id,
         i.id,
         r.branch_id,
         i.product_name,
         i.unit,
         i.requested_quantity,
         ri.received_quantity,
         GREATEST(i.requested_quantity - COALESCE(t.received_quantity, 0), 0)::numeric,
         r.received_at,
         r.storage_deadline_at,
         (pg_catalog.now() > r.storage_deadline_at),
         r.receipt_photo_path,
         request.supplier,
         ri.item_verified,
         ri.quantity_verified,
         ri.expiry_checked,
         ri.expiry_date,
         ri.package_condition,
         ri.package_notes,
         ri.storage_method
    FROM public.inventory_receipt_items AS ri
    JOIN public.inventory_receipts AS r ON r.id = ri.receipt_id
    JOIN public.inventory_requests AS request ON request.id = r.request_id
    JOIN public.inventory_request_items AS i ON i.id = ri.request_item_id
    LEFT JOIN (
      SELECT ritems.request_item_id, SUM(ritems.received_quantity) AS received_quantity
        FROM public.inventory_receipt_items AS ritems
        JOIN public.inventory_receipts AS rct ON rct.id = ritems.receipt_id
       WHERE rct.branch_id = v_profile.branch_id
       GROUP BY ritems.request_item_id
    ) AS t ON t.request_item_id = ri.request_item_id
   WHERE r.branch_id = v_profile.branch_id
     AND ri.stored_at IS NULL
   ORDER BY r.received_at, ri.created_at
   LIMIT 200;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_open_inventory_receipt_tasks() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_open_inventory_receipt_tasks() TO authenticated;

CREATE OR REPLACE FUNCTION public.complete_inventory_receipt_item(
  p_receipt_item_id uuid,
  p_item_verified boolean,
  p_quantity_verified boolean,
  p_expiry_checked boolean,
  p_expiry_date date,
  p_package_condition text,
  p_package_notes text,
  p_storage_method text
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_profile record;
  v_branch_id uuid;
  v_stored_at timestamptz;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'يلزم تسجيل الدخول لإكمال مهمة الاستلام';
  END IF;
  SELECT p.id, p.branch_id, p.role, p.status
    INTO v_profile
    FROM public.profiles AS p
   WHERE p.id = (SELECT auth.uid());
  IF NOT FOUND OR v_profile.status IS DISTINCT FROM 'active'
     OR v_profile.role IS DISTINCT FROM 'Supervisor'
     OR v_profile.branch_id IS NULL THEN
    RAISE EXCEPTION 'إكمال مهمة الاستلام متاح للمشرف النشط فقط';
  END IF;

  SELECT r.branch_id, ri.stored_at
    INTO v_branch_id, v_stored_at
    FROM public.inventory_receipt_items AS ri
    JOIN public.inventory_receipts AS r ON r.id = ri.receipt_id
   WHERE ri.id = p_receipt_item_id
   FOR UPDATE OF ri;
  IF NOT FOUND OR v_branch_id IS DISTINCT FROM v_profile.branch_id THEN
    RAISE EXCEPTION 'مهمة الاستلام غير موجودة ضمن فرع حسابك';
  END IF;
  IF NOT public.is_inventory_receiving_branch_operational(v_branch_id) THEN
    RAISE EXCEPTION 'لا يمكن إكمال مهمة استلام قبل افتتاح الفرع المؤكد';
  END IF;
  IF v_stored_at IS NOT NULL THEN
    RETURN v_stored_at;
  END IF;
  IF p_item_verified IS DISTINCT FROM true
     OR p_quantity_verified IS DISTINCT FROM true
     OR p_expiry_checked IS DISTINCT FROM true
     OR p_package_condition IS NULL
     OR p_package_condition NOT IN ('intact', 'damaged', 'compromised')
     OR p_storage_method IS NULL
     OR p_storage_method NOT IN ('FIFO', 'FEFO')
     OR (p_package_condition <> 'intact' AND NULLIF(pg_catalog.btrim(p_package_notes), '') IS NULL)
     OR (p_package_notes IS NOT NULL AND pg_catalog.length(p_package_notes) > 2000) THEN
    RAISE EXCEPTION 'أكمل فحص الصنف والكمية والصلاحية وحالة العبوة وطريقة FIFO/FEFO';
  END IF;

  UPDATE public.inventory_receipt_items AS ri
     SET item_verified = p_item_verified,
         quantity_verified = p_quantity_verified,
         expiry_checked = p_expiry_checked,
         expiry_date = p_expiry_date,
         package_condition = p_package_condition,
         package_notes = NULLIF(pg_catalog.btrim(p_package_notes), ''),
         storage_method = p_storage_method,
         stored_at = pg_catalog.now()
   WHERE ri.id = p_receipt_item_id
  RETURNING ri.stored_at INTO v_stored_at;
  RETURN v_stored_at;
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_inventory_receipt_item(uuid, boolean, boolean, boolean, date, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_inventory_receipt_item(uuid, boolean, boolean, boolean, date, text, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
