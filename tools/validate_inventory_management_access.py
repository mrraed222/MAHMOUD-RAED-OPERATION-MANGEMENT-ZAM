#!/usr/bin/env python3
"""Static regression checks for scoped inventory history and supervisor-only creation."""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase/migrations/20261116134500_inventory_management_scoped_permissions.sql"
PERMISSIONS = ROOT / "permissions/index.html"
INVENTORY = ROOT / "inventory-requests/index.html"
NAV = ROOT / "assets/supabase-config.js"

migration = MIGRATION.read_text(encoding="utf-8")
permissions = PERMISSIONS.read_text(encoding="utf-8")
inventory = INVENTORY.read_text(encoding="utf-8")
nav = NAV.read_text(encoding="utf-8")

# Function execution stays limited to authenticated callers, with no anon/PUBLIC grant.
assert "REVOKE ALL ON FUNCTION public.create_inventory_request(text, text, jsonb) FROM PUBLIC, anon;" in migration
assert "GRANT EXECUTE ON FUNCTION public.create_inventory_request(text, text, jsonb) TO authenticated;" in migration
assert "auth.uid()" in migration
assert "v_profile.status IS DISTINCT FROM 'active'" in migration
assert "v_profile.role IS DISTINCT FROM 'Supervisor'" in migration
assert "IF v_profile.branch_id IS NULL THEN" in migration
assert "SECURITY DEFINER" in migration and "SET search_path = ''" in migration

# Inventory visibility is checked by RLS using server-derived identity and the saved branch scope.
for column in ("can_manage_inventory", "can_view_all_inventory", "inventory_branch_ids"):
    assert column in migration
assert "public.can_view_inventory_branch(branch_id)" in migration
assert "public.can_view_inventory_branch(r.branch_id)" in migration
assert "p.id = (SELECT auth.uid())" in migration
assert "ap.can_manage_inventory" in migration
assert "p_branch_id = ANY(ap.inventory_branch_ids)" in migration

# Owner can configure either all branches or a non-empty set of selected branches.
assert "can_manage_inventory', label: 'إدارة الجرد والاطلاع على سجلات الطلبات'" in permissions
assert "value=\"all\"" in permissions and "value=\"selected\"" in permissions
assert "inventory_branch_ids = payload.can_manage_inventory" in permissions
assert "اختر فرعاً واحداً على الأقل" in permissions

# Page verifies the Supabase-authenticated user, and only an assigned active supervisor can create.
assert "authData.session.user.id !== currentUser?.id" in inventory
assert "inventoryAccess?.canCreate || currentUser?.role !== 'Supervisor'" in inventory
assert "zamClient.rpc('create_inventory_request'" in inventory
assert ".in('branch_id', inventoryAccess.branchIds)" in inventory
assert "history-branch-filter" in inventory
assert "branches(name)" in inventory
assert "inventory_branch_ids.forEach(id => branchIds.add(id))" in inventory
assert "if (access.canCreate) addItemRow();" in inventory
assert not re.search(r"from\(['\"]inventory_requests['\"]\)\s*\.insert", inventory)

# Supervisors retain the operational link; other users need the new explicit permission.
assert "perm: 'can_manage_inventory'" in nav
assert "i.key === 'inventory-requests' && role === 'Supervisor'" in nav
assert "'inventory-requests'" in nav[nav.index("const ZAM_OWNER_NAV_KEYS"):nav.index("]);", nav.index("const ZAM_OWNER_NAV_KEYS"))]

print("PASS: supervisor-only create RPC, authenticated execute ACL, and branch-scoped history checks")
