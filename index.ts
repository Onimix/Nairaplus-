// ============================================================
// NairaPlus — paystack-transfer Edge Function
// Deploy this in Supabase Dashboard → Edge Functions → New Function
// (name it "paystack-transfer"), or via CLI:
//   supabase functions deploy paystack-transfer
//
// Required secrets (set in Dashboard → Edge Functions → Secrets,
// or via CLI: supabase secrets set KEY=value):
//   PAYSTACK_SECRET_KEY   -> from your Paystack dashboard (Settings → API Keys)
//   SUPABASE_URL          -> your project URL (auto-available)
//   SUPABASE_SERVICE_ROLE_KEY -> Project Settings → API → service_role key
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const PAYSTACK_SECRET_KEY = Deno.env.get('PAYSTACK_SECRET_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json({ success: false, message: 'Missing auth header.' }, 401);
    }

    // Client scoped to the calling user — used only to verify who they are
    const userClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } }
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ success: false, message: 'Not authenticated.' }, 401);

    // Admin-privileged client for the actual DB writes
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: profile } = await admin.from('profiles').select('is_admin').eq('id', user.id).single();
    if (!profile?.is_admin) {
      return json({ success: false, message: 'Not authorized — admin only.' }, 403);
    }

    const { withdrawal_id, bank_code } = await req.json();
    if (!withdrawal_id || !bank_code) {
      return json({ success: false, message: 'withdrawal_id and bank_code are required.' }, 400);
    }

    const { data: w, error: wErr } = await admin.from('withdrawals').select('*').eq('id', withdrawal_id).single();
    if (wErr || !w) return json({ success: false, message: 'Withdrawal not found.' }, 404);
    if (w.status !== 'pending' && w.status !== 'approved') {
      return json({ success: false, message: `Withdrawal already ${w.status}.` }, 400);
    }

    // 1. Create a Paystack transfer recipient
    const recipientRes = await fetch('https://api.paystack.co/transferrecipient', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        type: 'nuban',
        name: w.account_name || w.user_id,
        account_number: w.account_number,
        bank_code,
        currency: 'NGN'
      })
    });
    const recipientData = await recipientRes.json();
    if (!recipientData.status) {
      return json({ success: false, message: 'Paystack recipient error: ' + recipientData.message }, 400);
    }
    const recipientCode = recipientData.data.recipient_code;

    // 2. Initiate the transfer (amount in kobo)
    const transferRes = await fetch('https://api.paystack.co/transfer', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        source: 'balance',
        amount: Math.round(w.amount * 100),
        recipient: recipientCode,
        reason: `NairaPlus withdrawal #${w.id}`
      })
    });
    const transferData = await transferRes.json();
    if (!transferData.status) {
      return json({ success: false, message: 'Paystack transfer error: ' + transferData.message }, 400);
    }

    // 3. Mark as paid
    await admin.from('withdrawals').update({
      status: 'paid',
      paystack_transfer_code: transferData.data.transfer_code,
      processed_at: new Date().toISOString()
    }).eq('id', withdrawal_id);

    return json({ success: true, message: 'Transfer initiated successfully.' });

  } catch (err) {
    return json({ success: false, message: 'Server error: ' + err.message }, 500);
  }
});

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
