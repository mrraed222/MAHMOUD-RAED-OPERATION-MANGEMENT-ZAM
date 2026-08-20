import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type SafeProfile = {
  id: string
  full_name: string
  email: string | null
  role: string | null
  branch_id: string | null
  employee_number: string | null
  status: string | null
  whatsapp_number: string | null
  avatar_url: string | null
  receives_branch_reports: boolean | null
  shift_type: string | null
  passcode_reset_requested: boolean | null
  last_sign_in_at: string | null
  last_login_at: string | null
  created_at: string | null
  branches: { name: string } | null
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { passcode } = await req.json()
    if (!passcode || typeof passcode !== 'string' || passcode.length < 4 || passcode.length > 20) {
      return new Response(JSON.stringify({ error: 'رمز مرور غير صالح' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Select an explicit allowlist. The stored passcode is intentionally never returned to the browser.
    const { data: profile, error: profileErr } = await supabaseAdmin
      .from('profiles')
      .select('id, full_name, email, role, branch_id, employee_number, status, whatsapp_number, avatar_url, receives_branch_reports, shift_type, passcode_reset_requested, last_sign_in_at, last_login_at, created_at, branches(name)')
      .eq('passcode', passcode)
      .maybeSingle<SafeProfile>()

    if (profileErr) throw profileErr
    if (!profile) {
      return new Response(JSON.stringify({ error: 'رمز المرور غير صحيح' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    if (profile.status === 'pending') {
      return new Response(JSON.stringify({ error: 'حسابك لسة قيد المراجعة من الإدارة. هيتم التواصل معاك قريبًا.' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    if (profile.status === 'rejected') {
      return new Response(JSON.stringify({ error: 'حسابك غير مفعّل. تواصل مع الإدارة.' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: existingAuthUser, error: getUserErr } = await supabaseAdmin.auth.admin.getUserById(profile.id)
    if (getUserErr || !existingAuthUser?.user?.email) {
      console.error('No linked auth user for profile', profile.id, getUserErr)
      return new Response(JSON.stringify({ error: 'حسابك محتاج ربط من الإدارة. اتصل بالمالك/الأدمن.' }), {
        status: 409,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email: existingAuthUser.user.email,
    })
    if (linkErr) throw linkErr

    await supabaseAdmin.from('profiles').update({ last_sign_in_at: new Date().toISOString() }).eq('id', profile.id)

    return new Response(JSON.stringify({ token_hash: linkData.properties.hashed_token, profile }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error(err)
    return new Response(JSON.stringify({ error: 'حدث خطأ في الخادم، حاول مرة أخرى' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
