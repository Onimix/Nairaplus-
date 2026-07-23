// ============================================================
// NairaPlus — app-data.js
// Wallet, tasks, reviews & withdrawals via Supabase (replaces data.js)
// All money math happens in Postgres functions (see schema.sql) —
// this file just calls them, never edits balances directly.
// ============================================================

async function npGetTiers(){
  const {data} = await supabase.from('tiers').select('*').order('sort_order');
  return data || [];
}

async function npGetWallet(userId){
  const {data} = await supabase.from('wallets').select('*').eq('user_id', userId).single();
  return data;
}

function npGetTierFor(tiers, trustScore){
  return tiers.find(t => trustScore >= t.min_score && trustScore <= t.max_score) || tiers[0];
}
function npNextTierFor(tiers, trustScore){
  const idx = tiers.findIndex(t => trustScore >= t.min_score && trustScore <= t.max_score);
  return tiers[idx+1] || null;
}

async function npAvailableTasks(userId){
  const {data: businesses} = await supabase.from('businesses').select('*').eq('active', true);
  const {data: done} = await supabase.from('reviews').select('business_id').eq('user_id', userId);
  const doneIds = (done || []).map(r => r.business_id);

  const wallet = await npGetWallet(userId);
  const tiers = await npGetTiers();
  const tier = npGetTierFor(tiers, wallet.trust_score);

  return (businesses || [])
    .filter(b => !doneIds.includes(b.id))
    .map(b => ({
      ...b,
      payout: Math.round((tier.rate_min + ((b.id * 37) % 100) / 100 * (tier.rate_max - tier.rate_min)) / 10) * 10
    }));
}

async function npGetReviews(userId){
  const {data} = await supabase
    .from('reviews')
    .select('*, businesses(name)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  return data || [];
}

async function npSubmitReview(businessId, stars, comment){
  const {data, error} = await supabase.rpc('submit_review', {
    p_business_id: businessId, p_stars: stars, p_comment: comment
  });
  if(error) return {success:false, message: error.message};
  return data; // { success, message, payout }
}

async function npRequestWithdrawal(amount, bankName, accountNumber, accountName){
  const {data, error} = await supabase.rpc('request_withdrawal', {
    p_amount: Number(amount), p_bank_name: bankName,
    p_account_number: accountNumber, p_account_name: accountName
  });
  if(error) return {success:false, message: error.message};
  return data;
}

async function npGetMyWithdrawals(userId){
  const {data} = await supabase.from('withdrawals').select('*').eq('user_id', userId).order('created_at', {ascending:false});
  return data || [];
}

// Common Nigerian banks with their Paystack bank codes (for the dropdown)
const NP_BANKS = [
  {name:'Access Bank', code:'044'},
  {name:'Zenith Bank', code:'057'},
  {name:'GTBank', code:'058'},
  {name:'First Bank of Nigeria', code:'011'},
  {name:'UBA', code:'033'},
  {name:'Fidelity Bank', code:'070'},
  {name:'Union Bank', code:'032'},
  {name:'Sterling Bank', code:'232'},
  {name:'Wema Bank', code:'035'},
  {name:'Stanbic IBTC', code:'221'},
  {name:'Ecobank', code:'050'},
  {name:'FCMB', code:'214'},
  {name:'Keystone Bank', code:'082'},
  {name:'Unity Bank', code:'215'},
  {name:'Polaris Bank', code:'076'},
  {name:'Opay', code:'999992'},
  {name:'Kuda Bank', code:'50211'},
  {name:'PalmPay', code:'999991'},
  {name:'Moniepoint', code:'50515'},
];
